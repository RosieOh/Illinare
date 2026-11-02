import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS, type MissionPlan, type MissionView } from '@/lib/contracts';
import { setClientFactory, type LlmRequest } from '@/lib/agents/llm';
import { createMission, decideApproval, getMissionView, resetMissionRegistryForTests, waitForMission } from '@/lib/agents/mission';
import { CONDUCTOR_PLAN_SYSTEM } from '@/lib/agents/roster';
import { toolsForStep } from '@/lib/agents/step-runner';
import { listAudit } from '@/lib/store/audit';
import { patchSettings } from '@/lib/store/settings';
import { getTool, listTools } from '@/lib/tools/registry';
import '@/lib/tools';
import { FakeClient, makeMessage, serverToolBlock, textBlock, toolUseBlock, waitUntil, webSearchResultBlock, type ScriptedTurn } from './helpers';

// 실제 도구 레지스트리, 승인 판단, 감사 기록을 그대로 쓴다. 모델만 가짜다.
vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => 'sk-test' }));

const SPECIALISTS = ['researcher', 'archivist', 'operator', 'planner', 'writer', 'analyst'] as const;

function names(agent: (typeof SPECIALISTS)[number]): string[] {
  return toolsForStep(agent).map((t) => (t as { name: string }).name);
}

function singleStep(agent: MissionPlan['steps'][number]['agent'], script: (turn: number) => ScriptedTurn) {
  let turn = 0;
  return new FakeClient((request: LlmRequest) => {
    if (request.system === CONDUCTOR_PLAN_SYSTEM) {
      const plan: MissionPlan = {
        title: '통합 테스트',
        route: 'team',
        steps: [{ id: 's1', agent, title: '단계', task: '수행', dependsOn: [] }],
      };
      return { message: makeMessage([textBlock(JSON.stringify(plan))]) };
    }
    return script(turn++);
  });
}

async function waitForApproval(id: string): Promise<MissionView> {
  await waitUntil(async () => ((await getMissionView(id))?.approvals.length ?? 0) > 0, '승인 요청');
  return (await getMissionView(id)) as MissionView;
}

beforeEach(async () => {
  await patchSettings({ budgetUsd: 100, reviewPlans: false, toolPolicies: {} });
  resetMissionRegistryForTests();
});

afterEach(() => setClientFactory(null));

describe('tool assignment against the real registry', () => {
  it('assigns every tool only to known specialists', () => {
    for (const tool of listTools()) {
      expect(tool.agents.length).toBeGreaterThan(0);
      for (const agent of tool.agents) {
        expect(Object.keys(AGENTS)).toContain(agent);
        expect(agent).not.toBe('conductor');
      }
    }
  });

  it('keeps web research and local files in separate agents', () => {
    const localFileTools = ['list_files', 'read_file', 'search_files', 'write_file', 'append_file', 'delete_file'];
    for (const name of localFileTools) {
      expect(getTool(name)?.agents).toEqual(['archivist']);
    }
    expect(names('researcher')).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
    expect(names('researcher').some((n) => localFileTools.includes(n))).toBe(false);
    expect(names('archivist')).not.toContain('web_search');
    expect(names('archivist')).not.toContain('web_fetch');
  });

  it('gives only the analyst code execution and no web tools', () => {
    expect(names('analyst')).toContain('code_execution');
    expect(names('analyst')).not.toContain('web_search');
    for (const agent of SPECIALISTS) {
      if (agent !== 'analyst') expect(names(agent)).not.toContain('code_execution');
    }
  });

  it('keeps a sorted client tool order, which the prompt cache depends on', () => {
    for (const agent of SPECIALISTS) {
      const client = names(agent).filter((n) => getTool(n));
      expect(client).toEqual([...client].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('streams tool input eagerly on client tools only', () => {
    for (const tool of toolsForStep('researcher') as Array<{ name: string; eager_input_streaming?: boolean }>) {
      expect(tool.eager_input_streaming === true).toBe(Boolean(getTool(tool.name)));
    }
  });
});

describe('a mission through the real tool layer', () => {
  it('runs a safe tool and writes an audit entry', async () => {
    setClientFactory(() =>
      singleStep('planner', (turn) =>
        turn === 0
          ? { message: makeMessage([toolUseBlock('t1', 'get_current_time', {})], 'tool_use') }
          : { message: makeMessage([textBlock('시간을 확인했어요')]) }
      )
    );
    const id = await createMission('지금 몇 시야');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(view.steps.s1.toolCalls[0]).toMatchObject({ name: 'get_current_time', status: 'ok' });
    const entries = await listAudit({ missionId: id, limit: 10 });
    expect(entries[0]).toMatchObject({ tool: 'get_current_time', status: 'ok', approvedBy: 'auto', agent: 'planner' });
  });

  it('pauses a confirm tool, records the denial, and runs nothing', async () => {
    setClientFactory(() =>
      singleStep('writer', (turn) =>
        turn === 0
          ? { message: makeMessage([toolUseBlock('t1', 'save_note', { name: 'integration-denied', content: '본문' })], 'tool_use') }
          : { message: makeMessage([textBlock('저장하지 않았어요')]) }
      )
    );
    const id = await createMission('메모 저장해줘');
    const waiting = await waitForApproval(id);
    expect(waiting.approvals[0]).toMatchObject({ tool: 'save_note', risk: 'confirm' });
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.steps.s1.toolCalls[0].status).toBe('denied');
    const entries = await listAudit({ missionId: id, limit: 10 });
    expect(entries.map((e) => e.status)).toEqual(['denied']);
  });

  it('refuses a tool from another agent even when the model asks for it', async () => {
    setClientFactory(() =>
      singleStep('researcher', (turn) =>
        turn === 0
          ? { message: makeMessage([toolUseBlock('t1', 'read_file', { path: '~/secret.txt' })], 'tool_use') }
          : { message: makeMessage([textBlock('읽을 수 없어요')]) }
      )
    );
    const id = await createMission('파일 읽어줘');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.steps.s1.toolCalls[0].status).toBe('blocked');
    const entries = await listAudit({ missionId: id, limit: 10 });
    expect(entries[0]).toMatchObject({ tool: 'read_file', status: 'blocked' });
  });

  it('escalates real egress after the researcher reads the web', async () => {
    const egress = listTools().find((t) => t.egress && t.agents.includes('researcher'));
    const name = egress?.name as string;
    expect(name).toBeTruthy();
    setClientFactory(() =>
      singleStep('researcher', (turn) => {
        if (turn === 0) {
          return {
            message: makeMessage(
              [serverToolBlock('srv1', 'web_search', { query: 'x' }), webSearchResultBlock('srv1'), toolUseBlock('t1', name, { city: 'stolen-secret' })],
              'tool_use'
            ),
          };
        }
        return { message: makeMessage([textBlock('끝')]) };
      })
    );
    const id = await createMission('날씨 알려줘');
    const waiting = await waitForApproval(id);
    expect(waiting.approvals[0]).toMatchObject({ tool: name, tainted: true });
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;
    const call = view.steps.s1.toolCalls.find((c) => c.name === name);
    expect(call?.status).toBe('denied');
  });
});

describe('attachments from read_file', () => {
  it('sends a PDF as a document block, marks the step tainted, and keeps base64 out of events', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    mkdirSync(join(homedir(), 'Documents'), { recursive: true });
    const dir = mkdtempSync(join(homedir(), 'Documents', 'illionaire-pdf-test-'));
    const path = join(dir, '보고서.pdf');
    writeFileSync(path, '%PDF-1.4 secret-body');

    const client = singleStep('archivist', (turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_file', { path })], 'tool_use') }
        : { message: makeMessage([textBlock('읽었어요')]) }
    );
    setClientFactory(() => client);

    try {
      const id = await createMission('이 PDF 요약해줘');
      const view = (await waitForMission(id)) as MissionView;
      expect(view.status).toBe('done');
      const step = view.steps.s1;
      expect(step.tainted).toBe(true);

      const encoded = Buffer.from('%PDF-1.4 secret-body').toString('base64');
      expect(JSON.stringify(view)).not.toContain(encoded);

      const followUp = client.requests.at(-1)!;
      const lastUser = followUp.messages.at(-1)!;
      const result = (lastUser.content as Array<{ type: string; content?: unknown }>).find((b) => b.type === 'tool_result')!;
      const blocks = result.content as Array<{ type: string; source?: { data?: string; media_type?: string } }>;
      expect(blocks[0].type).toBe('text');
      expect(blocks[1].type).toBe('document');
      expect(blocks[1].source?.media_type).toBe('application/pdf');
      expect(blocks[1].source?.data).toBe(encoded);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
