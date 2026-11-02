import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, promises as fs, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionEvent, MissionPlan, MissionView } from '@/lib/contracts';
import { recordedInput } from '@/lib/agents/context';
import { setClientFactory } from '@/lib/agents/llm';
import { cancelOrDeleteMission, createMission, decideApproval, followupMission, getMissionView, listMissionSummaries, openMissionFeed, resetMissionRegistryForTests, waitForMission } from '@/lib/agents/mission';
import { loadEvents, loadPendingInputs, loadSnapshot, settlePendingInputs } from '@/lib/agents/persistence';
import { CONDUCTOR_PLAN_SYSTEM } from '@/lib/agents/roster';
import { applyMissionEvent } from '@/lib/missions/reducer';
import { listAudit } from '@/lib/store/audit';
import { appendLine, dataPath, writeJson } from '@/lib/store/json';
import { patchSettings } from '@/lib/store/settings';
import { deleteAllData, exportAll } from '@/lib/store/transfer';
import '@/lib/tools';
import { getTool } from '@/lib/tools/registry';
import { FakeClient, makeMessage, serverToolBlock, textBlock, toolUseBlock, waitUntil, webSearchResultBlock, type ScriptedTurn } from './helpers';

vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => 'sk-test', clearApiKey: async () => undefined }));

const SECRET = '기밀-본문-WRITE-CONTENT-7f3a';
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function singleStep(agent: MissionPlan['steps'][number]['agent'], script: (turn: number) => ScriptedTurn) {
  let turn = 0;
  return new FakeClient((request) => {
    if (request.system === CONDUCTOR_PLAN_SYSTEM) {
      const plan: MissionPlan = { title: '기록', route: 'team', steps: [{ id: 's1', agent, title: '단계', task: '수행', dependsOn: [] }] };
      return { message: makeMessage([textBlock(JSON.stringify(plan))]) };
    }
    return script(turn++);
  });
}

/** 도구 하나를 부르고 끝나는 단계 */
function callThenFinish(name: string, input: unknown) {
  return (turn: number): ScriptedTurn =>
    turn === 0 ? { message: makeMessage([toolUseBlock('t1', name, input)], 'tool_use') } : { message: makeMessage([textBlock('끝')]) };
}

async function waitForApproval(id: string): Promise<MissionView> {
  await waitUntil(async () => ((await getMissionView(id))?.approvals.length ?? 0) > 0, '승인 요청');
  return (await getMissionView(id)) as MissionView;
}

const logFile = (id: string) => dataPath('missions', `${id}.jsonl`);
const pendingFile = (id: string) => dataPath('missions-pending', `${id}.json`);

async function everythingOnDisk(id: string): Promise<string> {
  const read = async (file: string) => fs.readFile(file, 'utf8').catch(() => '');
  return [await read(logFile(id)), await read(dataPath('missions', `${id}.json`)), await read(dataPath('audit.jsonl')), JSON.stringify(await exportAll())].join('\n');
}

describe('recordedInput', () => {
  it('keeps identifiers and replaces free text with its length and hash', () => {
    const recorded = recordedInput({ path: '~/Documents/a.txt', content: '안녕' }) as { path: string; content: { bytes: number; sha256: string } };
    expect(recorded.path).toBe('~/Documents/a.txt');
    expect(recorded.content).toEqual({ bytes: 6, sha256: sha('안녕') });
  });

  it('denies by default: a field nobody listed does not survive', () => {
    expect(JSON.stringify(recordedInput({ somethingNew: SECRET }))).not.toContain(SECRET);
    expect(JSON.stringify(recordedInput({ text: SECRET, body: SECRET, note: SECRET, content: SECRET, title: SECRET }))).not.toContain(SECRET);
  });

  it('keeps numbers, booleans and null, which carry no free text', () => {
    expect(recordedInput({ level: 40, enabled: true, none: null })).toEqual({ level: 40, enabled: true, none: null });
  });

  it('hashes nested values and non-object input', () => {
    const slides = [{ type: 'title', title: SECRET }];
    expect(JSON.stringify(recordedInput({ slides }))).not.toContain(SECRET);
    expect(JSON.stringify(recordedInput(SECRET))).not.toContain(SECRET);
    expect(JSON.stringify(recordedInput([SECRET]))).not.toContain(SECRET);
    expect(recordedInput(undefined)).toBeUndefined();
  });

  it('keeps what leaves the machine visible: search queries and URLs', () => {
    expect(recordedInput({ query: '경쟁사 가격' })).toEqual({ query: '경쟁사 가격' });
    expect(recordedInput({ url: 'https://example.com/a' })).toEqual({ url: 'https://example.com/a' });
  });

  it('clips an identifier that is absurdly long', () => {
    expect((recordedInput({ path: 'x'.repeat(5000) }) as { path: string }).path.length).toBeLessThan(2100);
  });
});

describe('a write waiting for approval', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const savedHome = process.env[homeKey];
  let home: string;

  beforeAll(() => {
    home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'illionaire-record-')));
    mkdirSync(path.join(home, 'Documents'), { recursive: true });
    process.env[homeKey] = home;
  });

  afterAll(() => {
    process.env[homeKey] = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await patchSettings({ budgetUsd: 100, reviewPlans: false, toolPolicies: {} });
    // 에이전트가 저장한 기억은 다음 미션을 오염 상태로 시작하게 하고, 내보내기에도 정당하게 들어간다.
    await writeJson(dataPath('memory.json'), []);
    resetMissionRegistryForTests();
  });

  afterEach(() => setClientFactory(null));

  // 예전 한도(입력 2,000자, 미리보기 8KB)를 모두 넘는 내용. 비밀은 끝에 있다.
  const content = `${'가나다라 '.repeat(4000)}\n${SECRET}`;
  const input = { path: '~/Documents/report.txt', content };

  async function pendingWrite(toolInput: unknown = input) {
    setClientFactory(() => singleStep('archivist', callThenFinish('write_file', toolInput)));
    const id = await createMission('보고서 저장해줘');
    return { id, waiting: await waitForApproval(id) };
  }

  it('shows the whole content on the card, past the old 2,000 char and 8KB limits', async () => {
    const { id, waiting } = await pendingWrite();
    const { preview } = waiting.approvals[0];
    expect(preview?.kind).toBe('diff');
    expect(preview?.after).toBe(content);
    expect(preview?.truncated).toBe(false);
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });

  it('still clips what is beyond any model output, and says so', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const preview = await getTool('write_file')!.preview!({ path: '~/Documents/huge.txt', content: huge });
    expect(preview?.truncated).toBe(true);
    expect(preview?.after?.length).toBeLessThan(huge.length);
  });

  it('keeps the original input in the separate file, and nothing else on disk holds it', async () => {
    const { id, waiting } = await pendingWrite();
    await waitUntil(() => existsSync(pendingFile(id)), '입력 파일');
    const pending = await loadPendingInputs(id);
    expect(pending[waiting.approvals[0].id]).toMatchObject({ tool: 'write_file', callId: 't1', stepId: 's1', input });

    await waitUntil(async () => (await loadEvents(id)).some((e) => e.type === 'approval.requested'), '이벤트 저장');
    expect(await fs.readFile(logFile(id), 'utf8')).not.toContain(SECRET);
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });

  it('shows the file path, byte length and hash in the tool row instead of the content', async () => {
    const { id, waiting } = await pendingWrite();
    expect(waiting.steps.s1.toolCalls[0].input).toEqual({
      path: input.path,
      content: { bytes: Buffer.byteLength(content), sha256: sha(content) },
    });
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });

  it('deletes the original on approval, writes the whole file, and retains only the summary', async () => {
    const { id, waiting } = await pendingWrite();
    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(readFileSync(path.join(home, 'Documents', 'report.txt'), 'utf8')).toBe(content);

    expect(existsSync(pendingFile(id))).toBe(false);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(await everythingOnDisk(id)).not.toContain(SECRET);
    // 저장된 해시로 실제 파일을 대조할 수 있다.
    const recorded = (await loadEvents(id)).find((e) => e.type === 'tool.started') as Extract<MissionEvent, { type: 'tool.started' }>;
    expect((recorded.call.input as { content: { sha256: string } }).content.sha256).toBe(sha(readFileSync(path.join(home, 'Documents', 'report.txt'), 'utf8')));
  });

  it('deletes the original on denial too', async () => {
    const { id, waiting } = await pendingWrite();
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
    expect(existsSync(pendingFile(id))).toBe(false);
    expect(await everythingOnDisk(id)).not.toContain(SECRET);
  });

  it('deletes the original when the mission is cancelled', async () => {
    const { id } = await pendingWrite();
    await cancelOrDeleteMission(id);
    await waitForMission(id);
    expect(existsSync(pendingFile(id))).toBe(false);
    expect(await everythingOnDisk(id)).not.toContain(SECRET);
  });

  it('replays the preview to a reconnecting client only while the approval is pending', async () => {
    const { id, waiting } = await pendingWrite();
    const feed = await openMissionFeed(id);
    const replay = () => {
      const seen: MissionEvent[] = [];
      feed?.attach(0, (e) => seen.push(e))();
      return JSON.stringify(seen);
    };
    expect(replay()).toContain(SECRET);
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    expect(replay()).not.toContain(SECRET);
    await waitForMission(id);
    expect(replay()).not.toContain(SECRET);
  });

  it('removes a pending input with the mission, and with delete-all', async () => {
    const { id, waiting } = await pendingWrite();
    await waitUntil(() => existsSync(pendingFile(id)), '입력 파일');
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);

    await writeJson(pendingFile(id), { ap_x: { input: { content: SECRET }, requestedAt: 1, interruptedAt: Date.now() } });
    await cancelOrDeleteMission(id);
    expect(existsSync(pendingFile(id))).toBe(false);

    await writeJson(pendingFile('m_other'), { ap_y: { input: { content: SECRET }, requestedAt: 1 } });
    await deleteAllData();
    expect(existsSync(dataPath('missions-pending'))).toBe(false);
  });

  describe('card summaries that quote content', () => {
    it('shows the clipboard text on the card but records only its length', async () => {
      const text = `복사할-${SECRET}-내용`;
      setClientFactory(() => singleStep('operator', callThenFinish('set_clipboard', { text })));
      const id = await createMission('복사해줘');
      const waiting = await waitForApproval(id);
      expect(waiting.approvals[0].summary).toContain(SECRET);
      expect(waiting.approvals[0].preview?.text).toContain(SECRET);
      expect(waiting.steps.s1.toolCalls[0].summary).not.toContain(SECRET);
      await decideApproval(id, waiting.approvals[0].id, 'deny', false);
      await waitForMission(id);
      expect(await everythingOnDisk(id)).not.toContain(SECRET);
      const audit = await listAudit({ missionId: id });
      expect(audit[0].summary).toMatch(/클립보드에 복사 \(\d+자\)/);
    });

    it('never stores a remembered sentence in the mission record', async () => {
      setClientFactory(() => singleStep('planner', callThenFinish('remember', { text: SECRET })));
      const id = await createMission('기억해줘');
      const waiting = await waitForApproval(id);
      expect(waiting.approvals[0].summary).toContain(SECRET);
      await decideApproval(id, waiting.approvals[0].id, 'approve', false);
      await waitForMission(id);
      const log = await fs.readFile(logFile(id), 'utf8');
      expect(log).not.toContain(SECRET);
      expect((await listAudit({ missionId: id }))[0].result).not.toContain(SECRET);
    });
  });

  it('records a safe tool that never needed approval in the same way', async () => {
    await patchSettings({ toolPolicies: { write_file: 'allow' } });
    setClientFactory(() => singleStep('archivist', callThenFinish('write_file', { path: '~/Documents/auto.txt', content: SECRET })));
    const id = await createMission('저장해줘');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(existsSync(pendingFile(id))).toBe(false);
    expect(await everythingOnDisk(id)).not.toContain(SECRET);
  });

  it('keeps search queries, URLs and sandbox code in the record, because the user must see what ran', async () => {
    setClientFactory(() =>
      singleStep('researcher', () => ({
        message: makeMessage([
          serverToolBlock('srv1', 'web_search', { query: '보여야-하는-검색어' }),
          webSearchResultBlock('srv1'),
          serverToolBlock('srv2', 'web_fetch', { url: 'https://example.com/visible' }),
          serverToolBlock('srv3', 'code_execution', { code: 'print("보여야-하는-코드")' }),
          textBlock('끝'),
        ]),
      }))
    );
    const id = await createMission('찾아줘');
    await waitForMission(id);
    const log = await fs.readFile(logFile(id), 'utf8');
    expect(log).toContain('보여야-하는-검색어');
    expect(log).toContain('https://example.com/visible');
    expect(log).toContain('보여야-하는-코드');
  });

  describe('across a restart', () => {
    const write = { type: 'tool.started', call: { callId: 't1', stepId: 's1', agent: 'archivist', name: 'write_file', summary: '파일 쓰기', input: { path: '~/a.txt', content: { bytes: 3, sha256: 'abc' } }, risk: 'confirm', status: 'running', startedAt: 3 } };
    const plan: MissionPlan = { title: 't', route: 'team', steps: [{ id: 's1', agent: 'archivist', title: 'a', task: 'b', dependsOn: [] }] };

    async function orphan(id: string, extra: object[] = []) {
      const lines = [
        { seq: 1, at: 1000, type: 'mission.created', id, goal: '이전 미션', mode: 'live', budgetUsd: 2 },
        { seq: 2, at: 1001, type: 'plan.ready', plan },
        { seq: 3, at: 1002, type: 'step.started', stepId: 's1' },
        { seq: 4, at: 1003, ...write },
        { seq: 5, at: 1004, type: 'approval.requested', approval: { id: 'ap_1', kind: 'tool', stepId: 's1', agent: 'archivist', callId: 't1', tool: 'write_file', summary: '파일 쓰기', risk: 'confirm', reason: 'r', requestedAt: 3 } },
        ...extra,
      ];
      await appendLine(logFile(id), lines.map((l) => JSON.stringify(l)).join('\n'));
      await writeJson(pendingFile(id), { ap_1: { callId: 't1', stepId: 's1', tool: 'write_file', input: { path: '~/a.txt', content: SECRET }, requestedAt: 3 } });
      resetMissionRegistryForTests();
    }

    it('survives a restart for a real pending approval, and the write does not run', async () => {
      const { id } = await pendingWrite({ path: '~/Documents/after-restart.txt', content: SECRET });
      // 디스크에 쓰인 뒤에 프로세스가 죽었다고 친다.
      await waitUntil(() => existsSync(pendingFile(id)) && existsSync(dataPath('missions', `${id}.json`)), '저장');
      await waitUntil(async () => (await loadEvents(id)).some((e) => e.type === 'approval.requested'), '이벤트 저장');
      resetMissionRegistryForTests();

      const view = (await getMissionView(id)) as MissionView;
      expect(view.status).toBe('failed');
      expect(view.approvals).toEqual([]);
      expect(view.steps.s1.toolCalls[0].status).toBe('denied');
      expect(view.steps.s1.toolCalls[0].input).toEqual({ path: '~/Documents/after-restart.txt', content: SECRET });
      expect(existsSync(path.join(home, 'Documents', 'after-restart.txt'))).toBe(false);
      await fs.rm(pendingFile(id), { force: true });
    });

    it('closes the mission like before, and shows the original input on the failed call', async () => {
      const id = 'm_restartpending';
      await orphan(id);
      const view = (await getMissionView(id)) as MissionView;
      expect(view.status).toBe('failed');
      expect(view.error?.message).toContain('다시 시작');
      expect(view.steps.s1.status).toBe('skipped');
      expect(view.steps.s1.toolCalls[0]).toMatchObject({ status: 'denied', input: { path: '~/a.txt', content: SECRET } });
      expect(view.steps.s1.toolCalls[0].result).toContain('실행하지 않았어요');
    });

    it('keeps the original out of the log, the snapshot and the export', async () => {
      const id = 'm_restartclean';
      await orphan(id);
      await getMissionView(id);
      await listMissionSummaries();
      expect(await fs.readFile(logFile(id), 'utf8')).not.toContain(SECRET);
      expect(JSON.stringify(await loadSnapshot(id))).not.toContain(SECRET);
      expect(JSON.stringify(await exportAll())).not.toContain(SECRET);
    });

    it('still shows it after another restart, then forgets it on a follow-up', async () => {
      const id = 'm_restartfollowup';
      await orphan(id);
      await getMissionView(id);
      resetMissionRegistryForTests();
      expect(((await getMissionView(id)) as MissionView).steps.s1.toolCalls[0].input).toMatchObject({ content: SECRET });

      setClientFactory(() =>
        new FakeClient(() => ({ message: makeMessage([textBlock(JSON.stringify({ title: 't', route: 'answer', rationale: '', steps: [] }))]) }))
      );
      await followupMission(id, '다시 해줘');
      await waitForMission(id);
      expect(existsSync(pendingFile(id))).toBe(false);
      expect(JSON.stringify(await getMissionView(id))).not.toContain(SECRET);
    });

    it('forgets it when the mission is deleted', async () => {
      const id = 'm_restartdelete';
      await orphan(id);
      await getMissionView(id);
      await cancelOrDeleteMission(id);
      expect(existsSync(pendingFile(id))).toBe(false);
    });

    it('expires an interrupted input nobody came back for', async () => {
      const id = 'm_restartexpire';
      await writeJson(pendingFile(id), { ap_1: { input: { content: SECRET }, requestedAt: 1, interruptedAt: 1000 } });
      const week = 7 * 24 * 60 * 60 * 1000;
      expect(await settlePendingInputs(id, [], 1000 + week - 1)).toEqual([]);
      expect(existsSync(pendingFile(id))).toBe(true);
      await settlePendingInputs(id, [], 1000 + week + 1);
      expect(existsSync(pendingFile(id))).toBe(false);
    });

    it('discards an input whose decision was logged before the crash', async () => {
      const id = 'm_restartdecided';
      await orphan(id, [{ seq: 6, at: 1005, type: 'approval.resolved', id: 'ap_1', decision: 'deny' }]);
      const view = (await getMissionView(id)) as MissionView;
      expect(view.status).toBe('failed');
      expect(existsSync(pendingFile(id))).toBe(false);
      expect(JSON.stringify(view)).not.toContain(SECRET);
    });

    it('discards a leftover input of a mission that had already finished', async () => {
      const id = 'm_restartfinished';
      await orphan(id, [{ seq: 6, at: 1005, type: 'mission.finished', status: 'done' }]);
      await listMissionSummaries();
      expect(existsSync(pendingFile(id))).toBe(false);
    });
  });

  describe('missions saved by an earlier version', () => {
    it('still load, with the inputs they already hold', async () => {
      const id = 'm_oldrecord';
      const lines = [
        { seq: 1, at: 1000, type: 'mission.created', id, goal: 'g', mode: 'live', budgetUsd: 2 },
        { seq: 2, at: 1001, type: 'plan.ready', plan: { title: 't', route: 'team', steps: [{ id: 's1', agent: 'archivist', title: 'a', task: 'b', dependsOn: [] }] } },
        { seq: 3, at: 1002, type: 'tool.started', call: { callId: 't1', stepId: 's1', agent: 'archivist', name: 'write_file', summary: 's', input: { path: 'a.txt', content: 'old plain body' }, risk: 'confirm', status: 'running', startedAt: 3 } },
        { seq: 4, at: 1003, type: 'approval.requested', approval: { id: 'ap_old', kind: 'tool', agent: 'archivist', summary: 'old', risk: 'confirm', reason: 'r', requestedAt: 3 } },
        { seq: 5, at: 1004, type: 'approval.resolved', id: 'ap_old', decision: 'approve' },
        { seq: 6, at: 1005, type: 'mission.finished', status: 'done' },
      ];
      await appendLine(logFile(id), lines.map((l) => JSON.stringify(l)).join('\n'));
      resetMissionRegistryForTests();
      const view = (await getMissionView(id)) as MissionView;
      expect(view.status).toBe('done');
      expect(view.steps.s1.toolCalls[0].input).toEqual({ path: 'a.txt', content: 'old plain body' });
      expect((await listMissionSummaries()).some((s) => s.id === id)).toBe(true);
    });
  });

  it('the client reducer shows the preview while pending and drops it on decision', () => {
    const created = applyMissionEvent(null, { type: 'mission.created', id: 'm_r', goal: 'g', mode: 'live', budgetUsd: 1, seq: 1, at: 1 });
    const asked = applyMissionEvent(created, {
      type: 'approval.requested',
      seq: 2,
      at: 2,
      approval: { id: 'ap', kind: 'tool', agent: 'writer', summary: `카드 ${SECRET}`, recordSummary: '저장용', risk: 'confirm', reason: 'r', requestedAt: 2, preview: { kind: 'diff', before: '', after: SECRET } },
    });
    expect(asked.approvals[0].preview?.after).toBe(SECRET);
    expect(asked.approvals[0].summary).toContain(SECRET);
    const decided = applyMissionEvent(asked, { type: 'approval.resolved', id: 'ap', decision: 'deny', seq: 3, at: 3 });
    expect(JSON.stringify(decided)).not.toContain(SECRET);
  });
});
