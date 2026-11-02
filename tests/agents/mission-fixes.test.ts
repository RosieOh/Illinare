import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionPlan, MissionView, PlanStep } from '@/lib/contracts';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import { setClientFactory, type LlmClient, type LlmRequest, type StreamEvent } from '@/lib/agents/llm';
import { cancelApprovals, hasApproval, requestApproval } from '@/lib/agents/approvals';
import { loadEvents, loadSnapshot, replayEvents } from '@/lib/agents/persistence';
import { PLAN_FALLBACK_NOTE } from '@/lib/agents/planner';
import { CONDUCTOR_ANSWER_SYSTEM, CONDUCTOR_PLAN_SYSTEM, CONDUCTOR_SYNTH_SYSTEM, SPECIALISTS } from '@/lib/agents/roster';
import {
  cancelOrDeleteMission,
  createMission,
  decideApproval,
  followupMission,
  getMissionView,
  listMissionSummaries,
  openMissionFeed,
  resetMissionRegistryForTests,
  waitForMission,
} from '@/lib/agents/mission';
import { listAudit } from '@/lib/store/audit';
import { appendLine, dataPath } from '@/lib/store/json';
import { addMemory, listMemory, removeMemory } from '@/lib/store/memory';
import { getSettings, patchSettings } from '@/lib/store/settings';
import { register } from '@/lib/tools/registry';
import { deferred, FakeClient, makeMessage, serverToolBlock, taskOf, textBlock, toolUseBlock, waitUntil, webSearchResultBlock, type ScriptedTurn } from './helpers';

const mocks = vi.hoisted(() => ({
  apiKey: 'sk-test' as string | null,
  executeTool: vi.fn(),
  recordDenied: vi.fn(),
}));

vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => mocks.apiKey }));
vi.mock('@/lib/tools', () => ({}));
vi.mock('@/lib/tools/anthropic', () => ({ anthropicToolsFor: () => [] }));
vi.mock('@/lib/tools/execute', () => ({ executeTool: mocks.executeTool, recordDenied: mocks.recordDenied }));

const SCHEMA = { type: 'object', properties: {}, additionalProperties: true };
const ALL = ['researcher', 'archivist', 'operator', 'planner', 'writer', 'analyst'] as const;

beforeAll(() => {
  process.env.ILLIONAIRE_RETRY_DELAY_MS = '0';
  const base = { description: '', group: 'files' as const, schema: SCHEMA, run: async () => 'real run must not happen' };
  register({ ...base, name: 'read_thing', risk: 'safe', agents: [...ALL], readsUntrusted: true, summarize: () => '읽기' });
  register({ ...base, name: 'change_thing', risk: 'confirm', agents: [...ALL], summarize: () => '변경' });
  register({ ...base, name: 'quick_thing', risk: 'safe', agents: [...ALL], summarize: () => '빠름' });
});

function planOf(steps: PlanStep[]): MissionPlan {
  return { title: '테스트', route: 'team', rationale: '', steps };
}

function step(id: string, dependsOn: string[] = [], agent: PlanStep['agent'] = 'archivist'): PlanStep {
  return { id, agent, title: id, task: `task-${id}`, dependsOn };
}

type StepScript = (request: LlmRequest, turn: number) => ScriptedTurn | Promise<ScriptedTurn>;

function teamClient(plan: MissionPlan, scripts: Record<string, StepScript> = {}, answer = '최종 답변') {
  const turns = new Map<string, number>();
  return new FakeClient((request) => {
    if (request.system === CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock(JSON.stringify(plan))]) };
    if (request.system === CONDUCTOR_SYNTH_SYSTEM || request.system === CONDUCTOR_ANSWER_SYSTEM) {
      return { message: makeMessage([textBlock(answer)]) };
    }
    const id = taskOf(request).replace('task-', '');
    const turn = turns.get(id) ?? 0;
    turns.set(id, turn + 1);
    return scripts[id] ? scripts[id](request, turn) : { message: makeMessage([textBlock(`output-${id}`)]) };
  });
}

function use<T extends LlmClient>(client: T): T {
  setClientFactory(() => client);
  return client;
}

async function waitForApproval(id: string): Promise<MissionView> {
  await waitUntil(async () => ((await getMissionView(id))?.approvals.length ?? 0) > 0, '승인 요청');
  return (await getMissionView(id)) as MissionView;
}

const eventsFile = (id: string) => readFileSync(dataPath('missions', `${id}.jsonl`), 'utf8');

function streamError(type: string) {
  return new Anthropic.APIError(undefined, { type: 'error', error: { type, message: 'x' } }, undefined, new Headers(), type as never);
}

beforeEach(async () => {
  mocks.apiKey = 'sk-test';
  mocks.executeTool.mockReset();
  mocks.recordDenied.mockReset();
  mocks.executeTool.mockImplementation(async (name: string) => ({ status: 'ok', content: `ran ${name}`, auditId: 'a' }));
  mocks.recordDenied.mockResolvedValue(undefined);
  await patchSettings({ ...DEFAULT_SETTINGS, budgetUsd: 100 });
  for (const item of await listMemory()) await removeMemory(item.id);
  resetMissionRegistryForTests();
});

afterEach(() => setClientFactory(null));

describe('web access after tainted data (security 1)', () => {
  const reader: StepScript = (_r, turn) =>
    turn === 0
      ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
      : { message: makeMessage([textBlock('요약 끝. 출처: https://attacker.example/c?d=secret')]) };

  const toolNames = (request: LlmRequest) => (request.tools ?? []).map((t) => (t as { name: string }).name);

  it('asks once before a tainted researcher starts, showing the task and upstream text', async () => {
    const client = use(teamClient(planOf([step('a'), step('b', ['a'], 'researcher')]), { a: reader }));
    const id = await createMission('요약하고 자료 찾아줘');
    const waiting = await waitForApproval(id);

    expect(waiting.approvals).toHaveLength(1);
    const approval = waiting.approvals[0];
    expect(approval).toMatchObject({ kind: 'tool', tool: 'web_access', risk: 'confirm', tainted: true, stepId: 'b' });
    expect(approval.reason).toContain('웹');
    expect(approval.preview?.text).toContain('task-b');
    expect(approval.preview?.text).toContain('https://attacker.example/c?d=secret');
    // 승인 전에는 모델을 호출하지 않는다.
    expect(client.requests.some((r) => r.system === SPECIALISTS.researcher.system)).toBe(false);

    await decideApproval(id, approval.id, 'approve', false);
    await waitForMission(id);
    const researcher = client.requests.find((r) => r.system === SPECIALISTS.researcher.system) as LlmRequest;
    expect(toolNames(researcher)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
    const audit = await listAudit({ missionId: id });
    expect(audit.some((e) => e.tool === 'web_access' && e.status === 'ok' && e.approvedBy === 'user')).toBe(true);
  });

  it('runs without web tools and tells the agent when denied', async () => {
    const client = use(teamClient(planOf([step('a'), step('b', ['a'], 'researcher')]), { a: reader }));
    const id = await createMission('요약하고 자료 찾아줘');
    const waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;

    const researcher = client.requests.find((r) => r.system === SPECIALISTS.researcher.system) as LlmRequest;
    expect(toolNames(researcher)).not.toContain('web_search');
    expect(toolNames(researcher)).not.toContain('web_fetch');
    expect(researcher.messages[0].content).toContain('did not allow web access');
    expect(view.steps.b.status).toBe('done');
    const audit = await listAudit({ missionId: id });
    expect(audit.some((e) => e.tool === 'web_access' && e.status === 'denied')).toBe(true);
  });

  it('does not ask when the researcher starts clean', async () => {
    const client = use(teamClient(planOf([step('b', [], 'researcher')])));
    const id = await createMission('자료 찾아줘');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    const researcher = client.requests.find((r) => r.system === SPECIALISTS.researcher.system) as LlmRequest;
    expect(toolNames(researcher)).toContain('web_search');
    expect((await loadEvents(id)).some((e) => e.type === 'approval.requested')).toBe(false);
  });

  it('never saves web_access as always allow', async () => {
    use(teamClient(planOf([step('a'), step('b', ['a'], 'researcher')]), { a: reader }));
    const id = await createMission('요약하고 자료 찾아줘');
    const waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'approve', true);
    await waitForMission(id);
    expect((await getSettings()).toolPolicies.web_access).toBeUndefined();
  });

  it('leaves memory, the user name and earlier turns out of the researcher prompt', async () => {
    await patchSettings({ displayName: '민수' });
    await addMemory('비밀 메모: 계좌번호 1234', 'user');
    const client = use(teamClient(planOf([step('a', [], 'writer')]), {}, '이전 답변'));
    const first = (await waitForMission(await createMission('첫 질문'))) as MissionView;

    use(client);
    await followupMission(first.id, '두 번째 질문');
    await waitForMission(first.id);
    const writerPrompt = client.requests.filter((r) => r.system === SPECIALISTS.writer.system).at(-1)?.messages[0].content as string;
    expect(writerPrompt).toContain('계좌번호');
    expect(writerPrompt).toContain('<earlier_turns>');

    const research = use(teamClient(planOf([step('b', [], 'researcher')]), {}, '이전 답변'));
    await followupMission(first.id, '세 번째 질문');
    await waitForMission(first.id);
    const prompt = research.requests.find((r) => r.system === SPECIALISTS.researcher.system)?.messages[0].content as string;
    expect(prompt).toContain('세 번째 질문');
    expect(prompt).not.toContain('계좌번호');
    expect(prompt).not.toContain('<user_memory>');
    expect(prompt).not.toContain('<earlier_turns>');
    expect(prompt).not.toContain('민수');
  });

  it('audits server-side web calls, which never pass through executeTool', async () => {
    const script: StepScript = () => ({
      message: makeMessage([serverToolBlock('srv1', 'web_search', { query: 'x' }), webSearchResultBlock('srv1'), textBlock('찾음')]),
    });
    use(teamClient(planOf([step('b', [], 'researcher')]), { b: script }));
    const id = await createMission('자료 찾아줘');
    await waitForMission(id);
    await waitUntil(async () => (await listAudit({ missionId: id })).some((e) => e.tool === 'web_search'), '감사 기록');
  });
});

describe('agent-written memory (security 2)', () => {
  it('starts steps tainted when any memory came from an agent', async () => {
    await addMemory('에이전트가 저장한 기억', 'agent');
    use(teamClient(planOf([step('a')])));
    const view = (await waitForMission(await createMission('목표'))) as MissionView;
    expect(view.steps.a.tainted).toBe(true);
  });

  it('asks a researcher for web access too, since the conductor read that memory', async () => {
    await addMemory('에이전트가 저장한 기억', 'agent');
    use(teamClient(planOf([step('b', [], 'researcher')])));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(waiting.approvals[0].tool).toBe('web_access');
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });

  it('stays clean when memory came only from the user', async () => {
    await addMemory('내가 직접 쓴 기억', 'user');
    use(teamClient(planOf([step('a')])));
    const view = (await waitForMission(await createMission('목표'))) as MissionView;
    expect(view.steps.a.tainted).toBe(false);
  });
});

describe('sensitive content stays out of the mission log (security 3)', () => {
  const readThing: StepScript = (_r, turn) =>
    turn === 0
      ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
      : { message: makeMessage([textBlock('ok')]) };

  it('logs displayContent while the model gets the full content', async () => {
    mocks.executeTool.mockImplementation(async () => ({
      status: 'ok',
      content: 'FAKE-PASSWORD-hunter2',
      displayContent: '클립보드를 읽었어요 (21자)',
      auditId: 'a',
    }));
    const client = use(teamClient(planOf([step('a')]), { a: readThing }));
    const id = await createMission('클립보드 봐줘');
    const view = (await waitForMission(id)) as MissionView;

    expect(view.steps.a.toolCalls[0].result).toBe('클립보드를 읽었어요 (21자)');
    expect(eventsFile(id)).not.toContain('hunter2');
    expect(JSON.stringify(await loadSnapshot(id))).not.toContain('hunter2');
    const results = client.requests.filter((r) => r.system === SPECIALISTS.archivist.system).at(-1)?.messages.at(-1)?.content as Array<{ content: string }>;
    expect(results[0].content).toContain('hunter2');
  });

  it('hides a read result even if displayContent is missing', async () => {
    mocks.executeTool.mockImplementation(async () => ({ status: 'ok', content: 'FAKE-PASSWORD-hunter2', auditId: 'a' }));
    use(teamClient(planOf([step('a')]), { a: readThing }));
    const id = await createMission('읽어줘');
    await waitForMission(id);
    expect(eventsFile(id)).not.toContain('hunter2');
  });

  it('keeps approval previews, which hold file bodies, off the disk', async () => {
    register({
      description: '',
      group: 'files',
      schema: SCHEMA,
      run: async () => '',
      name: 'previewed_thing',
      risk: 'confirm',
      agents: [...ALL],
      summarize: () => '변경',
      preview: async () => ({ kind: 'diff', path: 'a.txt', before: 'OLD-SECRET-BODY', after: 'new' }),
    });
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'previewed_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const id = await createMission('고쳐줘');
    const waiting = await waitForApproval(id);
    // 화면에는 그대로 보인다.
    expect(waiting.approvals[0].preview?.before).toBe('OLD-SECRET-BODY');
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
    expect(eventsFile(id)).not.toContain('OLD-SECRET-BODY');
    expect(JSON.stringify(await loadSnapshot(id))).not.toContain('OLD-SECRET-BODY');
  });
});

describe('cancel races (security 4)', () => {
  it('leaves no approval waiter when a later call in the turn would ask after cancel', async () => {
    const script: StepScript = () => ({
      message: makeMessage([toolUseBlock('t1', 'change_thing'), toolUseBlock('t2', 'change_thing')], 'tool_use'),
    });
    const running = deferred();
    mocks.executeTool.mockImplementation(async () => {
      await running.promise;
      return { status: 'ok', content: 'x', auditId: 'a' };
    });
    use(teamClient(planOf([step('a')]), { a: script }));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    await waitUntil(() => mocks.executeTool.mock.calls.length === 1, '첫 도구 실행');

    await cancelOrDeleteMission(id);
    running.resolve();
    const view = (await waitForMission(id)) as MissionView;
    await new Promise((r) => setTimeout(r, 30));

    expect(view.status).toBe('cancelled');
    const hub = (globalThis as unknown as { __illionaireApprovals: Map<string, Map<string, unknown>> }).__illionaireApprovals;
    expect(hub.get(id)?.size ?? 0).toBe(0);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  });

  it('does not start a queued safe tool after cancel', async () => {
    const seen = deferred();
    const script: StepScript = () => ({ message: makeMessage([toolUseBlock('t1', 'quick_thing')], 'tool_use') });
    const gateHold = deferred();
    use(
      teamClient(planOf([step('a')]), {
        a: async (r, turn) => {
          seen.resolve();
          await gateHold.promise;
          return script(r, turn);
        },
      })
    );
    const id = await createMission('목표');
    await seen.promise;
    await cancelOrDeleteMission(id);
    gateHold.resolve();
    await waitForMission(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it('removes the waiters of a mission that ended', () => {
    const id = 'm_waitertest';
    const pending = requestApproval(id, {
      id: 'ap_1',
      kind: 'tool',
      agent: 'writer',
      summary: '',
      risk: 'confirm',
      reason: '',
      requestedAt: 0,
    });
    pending.catch(() => undefined);
    expect(hasApproval(id, 'ap_1')).toBe(true);
    cancelApprovals(id);
    expect(hasApproval(id, 'ap_1')).toBe(false);
  });
});

describe('budget (security 5)', () => {
  /** message_start 뒤 본문을 계속 흘리는 호출. 끊길 때까지 멈추지 않는다. */
  function endlessWriters(plan: MissionPlan): LlmClient {
    const planner = teamClient(plan);
    return {
      stream(request, signal) {
        if (request.system === CONDUCTOR_PLAN_SYSTEM) return planner.stream(request, signal);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_start', message: makeMessage([], null, { input_tokens: 150_000, output_tokens: 1 }) } as unknown as StreamEvent;
            for (;;) {
              if (signal.aborted) throw new Anthropic.APIUserAbortError();
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '가'.repeat(2000) } } as unknown as StreamEvent;
              await new Promise((r) => setTimeout(r, 1));
            }
          },
          finalMessage: async () => {
            throw new Error('not reached');
          },
        };
      },
    };
  }

  it('cuts in-flight parallel calls near the cap instead of tripling it', async () => {
    await patchSettings({ budgetUsd: 2 });
    use(endlessWriters(planOf([step('a', [], 'writer'), step('b', [], 'writer'), step('c', [], 'writer')])));
    const id = await createMission('세 가지 써줘');
    const view = (await waitForMission(id)) as MissionView;

    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('budget_exceeded');
    expect(view.usage.costUsd).toBeGreaterThan(1.8);
    // 진행 중인 호출은 상한의 110%에서 끊는다.
    expect(view.usage.costUsd).toBeLessThan(2.35);
  }, 20_000);

  it('runs one call at a time when under 25% remains', async () => {
    await patchSettings({ budgetUsd: 1 });
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: StepScript = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { message: makeMessage([textBlock('ok')], 'end_turn', { input_tokens: 10, output_tokens: 1 }) };
    };
    const plan = planOf([step('a', [], 'writer'), step('b', [], 'writer'), step('c', [], 'writer')]);
    use(
      new FakeClient((request) => {
        if (request.system === CONDUCTOR_PLAN_SYSTEM) {
          // 계획에 예산의 80%를 쓴다.
          return { message: makeMessage([textBlock(JSON.stringify(plan))], 'end_turn', { input_tokens: 200_000, output_tokens: 0 }) };
        }
        return slow(request, 0);
      })
    );
    const id = await createMission('세 가지 써줘');
    await waitForMission(id);
    expect(maxInFlight).toBe(1);
  });

  it('caps max_tokens to a share of the budget, the only limit the API enforces', async () => {
    await patchSettings({ budgetUsd: 2 });
    const parallel = use(teamClient(planOf([step('a', [], 'writer'), step('b', [], 'writer'), step('c', [], 'writer')])));
    await waitForMission(await createMission('세 가지 써줘'));
    const caps = parallel.requests.filter((r) => r.system === SPECIALISTS.writer.system).map((r) => r.maxTokens);
    expect(caps).toHaveLength(3);
    // $2의 1/3을 Opus 출력 단가($20/MTok)로 나눈 값. 계획 호출의 비용만큼 조금 적다.
    for (const cap of caps) {
      expect(cap).toBeLessThanOrEqual(33_333);
      expect(cap).toBeGreaterThan(20_000);
    }

    resetMissionRegistryForTests();
    await patchSettings({ budgetUsd: 100 });
    const plenty = use(teamClient(planOf([step('a', [], 'writer'), step('b', [], 'writer')])));
    await waitForMission(await createMission('두 가지 써줘'));
    expect(plenty.requests.find((r) => r.system === SPECIALISTS.writer.system)?.maxTokens).toBe(64_000);
  });

  it('never goes below a usable floor', async () => {
    await patchSettings({ budgetUsd: 0.01 });
    const client = use(teamClient(planOf([step('a', [], 'writer')])));
    await waitForMission(await createMission('써줘'));
    const cap = client.requests.find((r) => r.system === SPECIALISTS.writer.system)?.maxTokens;
    expect(cap).toBe(4_000);
  });

  it('keeps full parallelism while plenty of budget remains', async () => {
    await patchSettings({ budgetUsd: 100 });
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: StepScript = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { message: makeMessage([textBlock('ok')]) };
    };
    use(teamClient(planOf([step('a', [], 'writer'), step('b', [], 'writer'), step('c', [], 'writer')]), { a: slow, b: slow, c: slow }));
    await waitForMission(await createMission('세 가지 써줘'));
    expect(maxInFlight).toBe(3);
  });

  it('charges a step that failed mid-stream', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: StepScript = () => ({
      message: makeMessage([textBlock('부분')], 'end_turn', { input_tokens: 5000, output_tokens: 1 }),
      errorAfterEvents: streamError('rate_limit_error'),
    });
    use(teamClient(planOf([step('a', [], 'writer')]), { a: failing }));
    const view = (await waitForMission(await createMission('써줘'))) as MissionView;
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('rate_limited');
    expect(view.steps.a.usage.inputTokens).toBe(5000);
    expect(view.usage.costUsd).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('empty answers (first contact 6)', () => {
  it('uses the earlier text when the final turn after a tool is empty', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([textBlock('지금은 오전 9시예요.'), toolUseBlock('t1', 'quick_thing')], 'tool_use') }
        : { message: makeMessage([], 'end_turn') };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = (await waitForMission(await createMission('몇 시야'))) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toBe('지금은 오전 9시예요.');
    expect(view.steps.a.output).toBe('지금은 오전 9시예요.');
  });

  it('says so instead of an empty answer when a tool ran but no text ever came', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'quick_thing')], 'tool_use') }
        : { message: makeMessage([], 'end_turn') };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = (await waitForMission(await createMission('해줘'))) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toContain('요약을 받지 못했어요');
  });

  it('fails a step that produced nothing, so dependents do not get empty input', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const empty: StepScript = () => ({ message: makeMessage([], 'end_turn') });
    const client = use(teamClient(planOf([step('a', [], 'writer'), step('b', ['a'], 'writer')]), { a: empty }));
    const view = (await waitForMission(await createMission('써줘'))) as MissionView;
    expect(view.status).toBe('failed');
    expect(view.steps.a.status).toBe('failed');
    expect(view.steps.b.status).toBe('skipped');
    expect(view.error?.message).toContain('빈 응답');
    expect(client.requests.some((r) => taskOf(r) === 'task-b')).toBe(false);
    spy.mockRestore();
  });

  it('never lets an empty answer.done erase the streamed answer', async () => {
    const { applyMissionEvent } = await import('@/lib/missions/reducer');
    const created = applyMissionEvent(null, { type: 'mission.created', id: 'm_x', goal: 'g', mode: 'live', budgetUsd: 1, seq: 1, at: 1 });
    const streamed = applyMissionEvent(created, { type: 'answer.delta', delta: '받은 답', seq: 2, at: 2 });
    expect(applyMissionEvent(streamed, { type: 'answer.done', text: '', seq: 3, at: 3 }).answer).toBe('받은 답');
    expect(applyMissionEvent(streamed, { type: 'answer.done', text: '최종', seq: 3, at: 3 }).answer).toBe('최종');
    expect(applyMissionEvent(streamed, { type: 'answer.done', text: '', clear: true, seq: 3, at: 3 }).answer).toBe('');
  });

  it('shows step outputs when synthesis comes back empty', async () => {
    const client = new FakeClient((request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock(JSON.stringify(planOf([step('a'), step('b')])))]) };
      if (request.system === CONDUCTOR_SYNTH_SYSTEM) return { message: makeMessage([], 'end_turn') };
      return { message: makeMessage([textBlock(`output-${taskOf(request)}`)]) };
    });
    use(client);
    const view = (await waitForMission(await createMission('목표'))) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toContain('output-task-a');
    expect(view.answer).toContain('output-task-b');
  });

  it('fails an empty direct answer instead of showing done with nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = new FakeClient((request) =>
      request.system === CONDUCTOR_PLAN_SYSTEM
        ? { message: makeMessage([textBlock(JSON.stringify({ title: 't', route: 'answer', rationale: '', steps: [] }))]) }
        : { message: makeMessage([], 'end_turn') }
    );
    use(client);
    const view = (await waitForMission(await createMission('안녕'))) as MissionView;
    expect(view.status).toBe('failed');
    expect(view.error?.message).toContain('빈 응답');
    spy.mockRestore();
  });
});

describe('retries on conductor calls (first contact 10)', () => {
  it('retries planning and synthesis on a mid-stream overload', async () => {
    let plans = 0;
    let synths = 0;
    const plan = planOf([step('a'), step('b')]);
    use(
      new FakeClient((request) => {
        if (request.system === CONDUCTOR_PLAN_SYSTEM) {
          plans++;
          return plans === 1 ? { error: streamError('overloaded_error') } : { message: makeMessage([textBlock(JSON.stringify(plan))]) };
        }
        if (request.system === CONDUCTOR_SYNTH_SYSTEM) {
          synths++;
          return synths === 1
            ? { message: makeMessage([textBlock('잘린 답')]), errorAfterEvents: streamError('overloaded_error') }
            : { message: makeMessage([textBlock('온전한 답')]) };
        }
        return { message: makeMessage([textBlock('ok')]) };
      })
    );
    const id = await createMission('목표');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(plans).toBe(2);
    expect(synths).toBe(2);
    expect(view.answer).toBe('온전한 답');
    expect((await loadEvents(id)).some((e) => e.type === 'answer.rollback')).toBe(true);
    // 부분 사용량까지 합쳐도 재생 결과가 실시간 상태와 같아야 한다.
    expect(replayEvents(await loadEvents(id))).toEqual(view);
  });

  it('rolls back partial step text on retry, leaving no concatenation', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([textBlock('partial ')]), errorAfterEvents: streamError('overloaded_error') }
        : { message: makeMessage([textBlock('final')]) };
    use(teamClient(planOf([step('a'), step('b')]), { a: script }));
    const id = await createMission('목표');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.steps.a.text).toBe('final');
    expect(view.steps.a.output).toBe('final');
    expect(replayEvents(await loadEvents(id))).toEqual(view);
  });
});

describe('planning fallback (first contact 12)', () => {
  it('uses a 32K cap and retries a truncated plan with less thinking, not by echoing it', async () => {
    const plan = planOf([step('a')]);
    const client = use(
      new FakeClient((request, index) => {
        if (request.system !== CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock('ok')]) };
        return index === 0
          ? { message: makeMessage([textBlock('{"title":"x","route":"te')], 'max_tokens') }
          : { message: makeMessage([textBlock(JSON.stringify(plan))]) };
      })
    );
    const view = (await waitForMission(await createMission('폴더 정리해줘'))) as MissionView;
    expect(view.plan?.route).toBe('team');
    expect(client.requests[0].maxTokens).toBe(32_000);
    expect(client.requests[1].messages).toEqual(client.requests[0].messages);
    expect(client.requests[1].effort).toBe('low');
  });

  it('says so visibly when planning fell back to a no-tools answer', async () => {
    const client = use(
      new FakeClient((request) =>
        request.system === CONDUCTOR_PLAN_SYSTEM
          ? { message: makeMessage([textBlock('{"title":"x","route":"te')], 'max_tokens') }
          : { message: makeMessage([textBlock('도구 없이 답할게요')]) }
      )
    );
    const view = (await waitForMission(await createMission('폴더 정리해줘'))) as MissionView;
    expect(view.plan).toMatchObject({ route: 'answer', degraded: true, rationale: PLAN_FALLBACK_NOTE });
    expect(view.answer.startsWith(PLAN_FALLBACK_NOTE)).toBe(true);
    expect(view.answer).toContain('도구 없이 답할게요');
    expect(client.requests.filter((r) => r.system === CONDUCTOR_PLAN_SYSTEM)).toHaveLength(2);
  });
});

describe('mid-stream refusal (first contact 13)', () => {
  const refused = { stop_details: { type: 'refusal', category: 'cyber', explanation: null } };

  it('clears the partial answer of a single-step plan and keeps it out of earlier turns', async () => {
    const script: StepScript = () => ({ message: makeMessage([textBlock('분류기에 걸린 부분 답변')], 'refusal', {}, refused as never) });
    use(teamClient(planOf([step('a', [], 'writer')]), { a: script }));
    const first = (await waitForMission(await createMission('써줘'))) as MissionView;
    expect(first.status).toBe('failed');
    expect(first.error?.code).toBe('refused');
    expect(first.answer).toBe('');
    expect(first.steps.a.text).toBe('');

    const client = use(teamClient({ title: 't', route: 'answer', steps: [] }, {}, '다음 답'));
    await followupMission(first.id, '다시');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.turns[0].answer).toBe('');
    expect(JSON.stringify(client.requests)).not.toContain('분류기에 걸린');
  });

  it('clears a partial conductor answer too', async () => {
    const client = new FakeClient((request) =>
      request.system === CONDUCTOR_PLAN_SYSTEM
        ? { message: makeMessage([textBlock(JSON.stringify({ title: 't', route: 'answer', rationale: '', steps: [] }))]) }
        : { message: makeMessage([textBlock('걸린 답변')], 'refusal', {}, refused as never) }
    );
    use(client);
    const view = (await waitForMission(await createMission('안녕'))) as MissionView;
    expect(view.error?.code).toBe('refused');
    expect(view.answer).toBe('');
  });
});

describe('turn limit (first contact 14)', () => {
  const looping: StepScript = () => ({ message: makeMessage([textBlock('지금까지의 결과'), toolUseBlock('t1', 'quick_thing')], 'tool_use') });

  it('keeps the last text as partial output', async () => {
    use(teamClient(planOf([step('a')]), { a: looping }));
    const view = (await waitForMission(await createMission('목표'))) as MissionView;
    expect(view.steps.a.status).toBe('failed');
    expect(view.steps.a.output).toBe('지금까지의 결과');
    expect(view.answer).toBe('지금까지의 결과');
    expect(view.error?.message).toContain('길어져');
  }, 15_000);

  it('passes the partial output to synthesis', async () => {
    const client = use(teamClient(planOf([step('a'), step('b')]), { a: looping }));
    const view = (await waitForMission(await createMission('목표'))) as MissionView;
    expect(view.status).toBe('done');
    const synth = client.requests.find((r) => r.system === CONDUCTOR_SYNTH_SYSTEM) as LlmRequest;
    expect(synth.messages[0].content).toContain('지금까지의 결과');
    expect(synth.messages[0].content).toContain('완료되지 않았습니다');
  }, 15_000);
});

describe('follow-ups (lifecycle 17, 18, 20)', () => {
  const answerClient = (usage = { input_tokens: 10, output_tokens: 10 }) =>
    new FakeClient((request) =>
      request.system === CONDUCTOR_PLAN_SYSTEM
        ? { message: makeMessage([textBlock(JSON.stringify({ title: 't', route: 'answer', rationale: '', steps: [] }))], 'end_turn', usage) }
        : { message: makeMessage([textBlock('답')], 'end_turn', usage) }
    );

  it('applies a raised budget to the follow-up', async () => {
    await patchSettings({ budgetUsd: 0.05 });
    use(answerClient({ input_tokens: 0, output_tokens: 3000 }));
    const first = (await waitForMission(await createMission('질문'))) as MissionView;
    expect(first.budgetUsd).toBe(0.05);

    await patchSettings({ budgetUsd: 50 });
    await followupMission(first.id, '이어서');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.status).toBe('done');
    expect(second.budgetUsd).toBe(50);
  });

  it('measures the budget per turn and exposes the starting cost', async () => {
    await patchSettings({ budgetUsd: 0.001 });
    use(answerClient({ input_tokens: 30, output_tokens: 20 }));
    const first = (await waitForMission(await createMission('질문'))) as MissionView;
    expect(first.turnStartCostUsd).toBe(0);
    expect(first.usage.costUsd).toBeGreaterThan(first.budgetUsd);
    const spentInFirstTurn = first.usage.costUsd;

    await followupMission(first.id, '이어서');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.status).toBe('done');
    expect(second.turnStartCostUsd).toBeCloseTo(spentInFirstTurn);
    expect(second.usage.costUsd - (second.turnStartCostUsd ?? 0)).toBeCloseTo(spentInFirstTurn);
    // 재생해도 같은 기준값이 나온다.
    expect(replayEvents(await loadEvents(first.id))).toEqual(second);
  });

  it('re-evaluates the mode: a demo mission goes live once a key exists', async () => {
    mocks.apiKey = null;
    process.env.ILLIONAIRE_DEMO_SPEED = '500';
    const demo = (await waitForMission(await createMission('안녕'))) as MissionView;
    expect(demo.mode).toBe('demo');

    mocks.apiKey = 'sk-test';
    const client = use(answerClient());
    await followupMission(demo.id, '이제 진짜로');
    const live = (await waitForMission(demo.id)) as MissionView;
    expect(live.mode).toBe('live');
    expect(client.requests.length).toBeGreaterThan(0);
    delete process.env.ILLIONAIRE_DEMO_SPEED;
  });

  it('goes back to demo when the key was removed', async () => {
    use(answerClient());
    const first = (await waitForMission(await createMission('질문'))) as MissionView;
    expect(first.mode).toBe('live');
    mocks.apiKey = null;
    process.env.ILLIONAIRE_DEMO_SPEED = '500';
    await followupMission(first.id, '이어서');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.mode).toBe('demo');
    delete process.env.ILLIONAIRE_DEMO_SPEED;
  });

  it('sets turnStartedAt at creation and again at each follow-up', async () => {
    use(answerClient());
    const first = (await waitForMission(await createMission('질문'))) as MissionView;
    expect(first.turnStartedAt).toBe(first.createdAt);
    await new Promise((r) => setTimeout(r, 5));
    await followupMission(first.id, '이어서');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.turnStartedAt ?? 0).toBeGreaterThan(second.createdAt);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('reads old events and snapshots that have none of the new fields', async () => {
    const { applyMissionEvent } = await import('@/lib/missions/reducer');
    const created = applyMissionEvent(null, { type: 'mission.created', id: 'm_old', goal: 'g', mode: 'demo', budgetUsd: 7, seq: 1, at: 5 });
    const legacy = { type: 'mission.followup', goal: 'g2', seq: 2, at: 9 } as never;
    const next = applyMissionEvent(created, legacy);
    expect(next).toMatchObject({ budgetUsd: 7, mode: 'demo', turnStartedAt: 9, turnStartCostUsd: 0 });

    const id = 'm_oldsnapshot';
    const { writeJson } = await import('@/lib/store/json');
    const oldView = { ...created, id };
    delete oldView.turnStartedAt;
    delete oldView.turnStartCostUsd;
    await writeJson(dataPath('missions', `${id}.json`), oldView);
    expect(await loadSnapshot(id)).toMatchObject({ turnStartedAt: 5, turnStartCostUsd: 0 });
  });
});

describe('restart recovery (lifecycle 19)', () => {
  async function orphan(id: string, extra = '') {
    const lines = [
      { seq: 1, at: 1000, type: 'mission.created', id, goal: '이전 미션', mode: 'live', budgetUsd: 2 },
      { seq: 2, at: 1001, type: 'mission.status', status: 'running' },
    ];
    await appendLine(dataPath('missions', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + extra);
    resetMissionRegistryForTests();
  }

  it('jumps seq far past anything a client may already have', async () => {
    const id = 'm_recoverjump';
    await orphan(id);
    await listMissionSummaries();
    const events = await loadEvents(id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 1003, 1004]);
  });

  it('delivers the failure to a client whose seq is ahead of the disk', async () => {
    const id = 'm_recoverahead';
    await orphan(id);
    const feed = await openMissionFeed(id);
    const got: number[] = [];
    // 클라이언트는 디스크에 쓰이기 전의 이벤트까지 봤다.
    const stop = feed?.attach(50, (e) => got.push(e.seq));
    stop?.();
    expect(got).toEqual([1003, 1004]);
    expect(feed?.isTerminal()).toBe(true);
    const { applyMissionEvent } = await import('@/lib/missions/reducer');
    const clientView = { ...((await getMissionView(id)) as MissionView), status: 'running' as const, seq: 50 };
    const events = (await loadEvents(id)).filter((e) => e.seq > 50);
    const final = events.reduce((v, e) => applyMissionEvent(v, e), clientView as MissionView);
    expect(final.status).toBe('failed');
  });

  it('survives a torn last line: the recovery events are not lost', async () => {
    const id = 'm_recovertorn';
    await orphan(id, '\n{"seq":3,"at":');
    const view = await (async () => {
      await listMissionSummaries();
      resetMissionRegistryForTests();
      return getMissionView(id);
    })();
    expect(view?.status).toBe('failed');
    expect(view?.error?.message).toContain('다시 시작');
    const events = await loadEvents(id);
    expect(events.at(-1)?.type).toBe('mission.finished');
  });
});

describe('client stream error handling (lifecycle 19)', () => {
  const view = (status: MissionView['status']) => ({ id: 'm_a', status, seq: 9 }) as MissionView;

  async function run(result: MissionView | Error, readyState = 0) {
    const { syncAfterStreamError } = await import('@/context/MissionsContext');
    const source = { readyState, close: vi.fn() };
    const onView = vi.fn();
    const onEnded = vi.fn();
    const onGone = vi.fn();
    await syncAfterStreamError({
      source: source as never,
      fetchView: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
      onView,
      onEnded,
      onGone,
    });
    return { source, onView, onEnded, onGone };
  }

  it('stops reconnecting once the snapshot is terminal', async () => {
    const r = await run(view('failed'));
    expect(r.onView).toHaveBeenCalledWith(view('failed'));
    expect(r.source.close).toHaveBeenCalled();
    expect(r.onEnded).toHaveBeenCalled();
  });

  it('keeps the stream while the mission is still running', async () => {
    const r = await run(view('running'));
    expect(r.source.close).not.toHaveBeenCalled();
    expect(r.onEnded).not.toHaveBeenCalled();
  });

  it('re-subscribes when the browser gave up on a running mission', async () => {
    const r = await run(view('running'), 2);
    expect(r.onEnded).toHaveBeenCalled();
  });

  it('forgets a mission the server no longer has', async () => {
    const { ClientApiError } = await import('@/lib/client/api');
    const r = await run(new ClientApiError(404, 'not_found', '없음'));
    expect(r.source.close).toHaveBeenCalled();
    expect(r.onGone).toHaveBeenCalled();
  });

  it('leaves reconnecting to EventSource while the server is down', async () => {
    const { ClientApiError } = await import('@/lib/client/api');
    const r = await run(new ClientApiError(0, 'network', '연결 안 됨'));
    expect(r.source.close).not.toHaveBeenCalled();
    expect(r.onGone).not.toHaveBeenCalled();
  });
});
