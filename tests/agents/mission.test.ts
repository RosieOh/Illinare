import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionPlan, MissionView, PlanStep } from '@/lib/contracts';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import type { LlmRequest } from '@/lib/agents/llm';
import { setClientFactory } from '@/lib/agents/llm';
import { CONDUCTOR_ANSWER_SYSTEM, CONDUCTOR_PLAN_SYSTEM, CONDUCTOR_SYNTH_SYSTEM } from '@/lib/agents/roster';
import { loadEvents, replayEvents } from '@/lib/agents/persistence';
import {
  cancelOrDeleteMission,
  createMission,
  decideApproval,
  followupMission,
  getMissionView,
  listMissionSummaries,
  MAX_GOAL_CHARS,
  resetMissionRegistryForTests,
  waitForMission,
} from '@/lib/agents/mission';
import { appendLine, dataPath } from '@/lib/store/json';
import { getSettings, patchSettings, setToolPolicy } from '@/lib/store/settings';
import { register } from '@/lib/tools/registry';
import { deferred, FakeClient, makeMessage, taskOf, textBlock, toolUseBlock, waitUntil, type ScriptedTurn } from './helpers';

const mocks = vi.hoisted(() => ({
  apiKey: 'sk-test' as string | null,
  executeTool: vi.fn(),
  recordDenied: vi.fn(),
}));

vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => mocks.apiKey }));
// 실제 도구를 실행하지 않는다. 등록도 테스트 도구만 한다.
vi.mock('@/lib/tools', () => ({}));
vi.mock('@/lib/tools/anthropic', () => ({ anthropicToolsFor: () => [] }));
vi.mock('@/lib/tools/execute', () => ({ executeTool: mocks.executeTool, recordDenied: mocks.recordDenied }));

const SCHEMA = { type: 'object', properties: {}, additionalProperties: true };
const AGENTS_ALL = ['researcher', 'archivist', 'operator', 'planner', 'writer', 'analyst'] as const;

beforeAll(() => {
  const base = { description: '', group: 'files' as const, schema: SCHEMA, run: async () => 'real run must not happen' };
  register({ ...base, name: 'read_thing', risk: 'safe', agents: [...AGENTS_ALL], readsUntrusted: true, summarize: () => '읽기' });
  register({ ...base, name: 'send_out', risk: 'safe', agents: [...AGENTS_ALL], egress: true, summarize: () => '내보내기' });
  register({ ...base, name: 'change_thing', risk: 'confirm', agents: [...AGENTS_ALL], summarize: () => '변경' });
  register({ ...base, name: 'delete_thing', risk: 'danger', agents: [...AGENTS_ALL], summarize: () => '삭제' });
  register({ ...base, name: 'archivist_only', risk: 'safe', agents: ['archivist'], summarize: () => '전용' });
  register({ ...base, name: 'strict_tool', risk: 'safe', agents: [...AGENTS_ALL], summarize: () => '엄격', schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false } });
});

function planOf(steps: PlanStep[], title = '테스트 미션'): MissionPlan {
  return { title, route: 'team', rationale: '', steps };
}

function step(id: string, dependsOn: string[] = [], agent: PlanStep['agent'] = 'archivist'): PlanStep {
  return { id, agent, title: id, task: `task-${id}`, dependsOn };
}

type StepScript = (request: LlmRequest, turnIndexForStep: number) => ScriptedTurn | Promise<ScriptedTurn>;

/** 시스템 프롬프트로 역할을 구분해 응답하는 가짜 클라이언트 */
function teamClient(plan: MissionPlan, scripts: Record<string, StepScript> = {}, answer = '최종 답변') {
  const turnCounts = new Map<string, number>();
  return new FakeClient((request) => {
    if (request.system === CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock(JSON.stringify(plan))]) };
    if (request.system === CONDUCTOR_SYNTH_SYSTEM || request.system === CONDUCTOR_ANSWER_SYSTEM) {
      return { message: makeMessage([textBlock(answer)]) };
    }
    const task = taskOf(request);
    const id = task.replace('task-', '');
    const turn = turnCounts.get(id) ?? 0;
    turnCounts.set(id, turn + 1);
    const script = scripts[id];
    return script ? script(request, turn) : { message: makeMessage([textBlock(`output-${id}`)]) };
  });
}

function use(client: FakeClient) {
  setClientFactory(() => client);
  return client;
}

async function run(goal = '목표'): Promise<MissionView> {
  const id = await createMission(goal);
  return (await waitForMission(id)) as MissionView;
}

async function waitForApproval(id: string) {
  await waitUntil(async () => ((await getMissionView(id))?.approvals.length ?? 0) > 0, '승인 요청');
  return (await getMissionView(id)) as MissionView;
}

function toolResultsOf(request: LlmRequest) {
  const last = request.messages.at(-1);
  return last?.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
}

beforeEach(async () => {
  mocks.apiKey = 'sk-test';
  mocks.executeTool.mockReset();
  mocks.recordDenied.mockReset();
  mocks.executeTool.mockImplementation(async (name: string) => ({ status: 'ok', content: `ran ${name}`, auditId: 'audit_1' }));
  mocks.recordDenied.mockResolvedValue(undefined);
  await patchSettings({ ...DEFAULT_SETTINGS, budgetUsd: 100 });
  await setToolPolicy('change_thing', 'default');
  resetMissionRegistryForTests();
});

afterEach(() => setClientFactory(null));

describe('scheduling', () => {
  it('runs steps in dependency order, at most three at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const slowStep: StepScript = async (request) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(taskOf(request).replace('task-', ''));
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { message: makeMessage([textBlock('ok')]) };
    };
    const steps = [step('a'), step('b'), step('c'), step('d'), step('e'), step('f', ['a', 'b', 'c', 'd', 'e'])];
    use(teamClient(planOf(steps), Object.fromEntries(steps.map((s) => [s.id, slowStep]))));

    const view = await run();
    expect(view.status).toBe('done');
    expect(maxInFlight).toBe(3);
    expect(order.at(-1)).toBe('f');
    expect(order).toHaveLength(6);
  });

  it('passes upstream output as untrusted plain text', async () => {
    const client = use(teamClient(planOf([step('a'), step('b', ['a'])])));
    await run();
    const bRequest = client.requests.find((r) => taskOf(r) === 'task-b') as LlmRequest;
    const content = bRequest.messages[0].content as string;
    expect(content).toContain('<upstream_output agent="archivist" step="a" trust="untrusted">');
    expect(content).toContain('output-a');
  });

  it('skips dependents of a failed step and still finishes the others', async () => {
    const failing: StepScript = () => ({ error: new Anthropic.BadRequestError(400, {}, 'bad', new Headers()) });
    use(teamClient(planOf([step('a'), step('b', ['a']), step('c')]), { a: failing }));
    const view = await run();
    expect(view.status).toBe('done');
    expect(view.steps.a.status).toBe('failed');
    expect(view.steps.b.status).toBe('skipped');
    expect(view.steps.c.status).toBe('done');
    expect(view.answer).toBe('최종 답변');
  });

  it('reports the failure when no step finishes', async () => {
    const authError = new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers());
    use(teamClient(planOf([step('a'), step('b')]), { a: () => ({ error: authError }), b: () => ({ error: authError }) }));
    const view = await run();
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('invalid_api_key');
    expect(view.error?.message).toContain('설정');
  });

  it('uses the single step output as the answer without a synthesis call', async () => {
    const client = use(teamClient(planOf([step('a')])));
    const view = await run();
    expect(view.answer).toBe('output-a');
    expect(client.requests.some((r) => r.system === CONDUCTOR_SYNTH_SYSTEM)).toBe(false);
    const content = client.requests.find((r) => taskOf(r) === 'task-a')?.messages[0].content as string;
    expect(content).toContain('goes straight to the user');
  });

  it('answers directly on the answer route with no steps or tools', async () => {
    const client = use(teamClient({ title: '인사', route: 'answer', steps: [] }, {}, '안녕하세요'));
    const view = await run('안녕');
    expect(view.answer).toBe('안녕하세요');
    expect(view.status).toBe('done');
    expect(view.stepOrder).toEqual([]);
    expect(client.requests.at(-1)?.tools ?? []).toEqual([]);
  });

  it('synthesizes multi-step results with the conductor', async () => {
    const client = use(teamClient(planOf([step('a'), step('b')])));
    const view = await run();
    const synth = client.requests.find((r) => r.system === CONDUCTOR_SYNTH_SYSTEM) as LlmRequest;
    expect(synth.messages[0].content).toContain('output-a');
    expect(synth.messages[0].content).toContain('output-b');
    expect(view.answer).toBe('최종 답변');
  });

  it('accumulates usage across planning, steps and synthesis', async () => {
    use(teamClient(planOf([step('a'), step('b')])));
    const view = await run();
    // 계획 + 단계 2개 + 종합, 호출마다 입력/출력 10토큰.
    expect(view.usage.inputTokens).toBe(40);
    expect(view.usage.costUsd).toBeGreaterThan(0);
    expect(view.steps.a.usage.inputTokens).toBe(10);
  });
});

describe('approvals', () => {
  it('suspends only the step that needs approval', async () => {
    const release = deferred();
    const needsApproval: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'change_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('a done')]) };
    const other: StepScript = async () => {
      await release.promise;
      return { message: makeMessage([textBlock('b done')]) };
    };
    use(teamClient(planOf([step('a'), step('b'), step('c')]), { a: needsApproval, b: other }));

    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(waiting.status).toBe('awaiting_approval');
    expect(waiting.steps.a.status).toBe('awaiting_approval');
    expect(waiting.steps.b.status).toBe('running');
    // 다른 단계는 승인을 기다리지 않고 끝난다.
    await waitUntil(async () => (await getMissionView(id))?.steps.c.status === 'done', '단계 c 완료');
    expect(mocks.executeTool).not.toHaveBeenCalled();

    release.resolve();
    await waitUntil(async () => (await getMissionView(id))?.steps.b.status === 'done', '단계 b 완료');
    expect((await getMissionView(id))?.status).toBe('awaiting_approval');

    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool.mock.calls[0][3]).toMatchObject({ approvedBy: 'user', tainted: false });
    expect(view.steps.a.toolCalls[0].status).toBe('ok');
  });

  it('turns a denial into an is_error result without running the tool', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'change_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('거부되어 건너뜀')]) };
    const client = use(teamClient(planOf([step('a')]), { a: script }));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;

    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.recordDenied).toHaveBeenCalledWith('change_thing', {}, expect.anything(), 'denied', false);
    expect(view.steps.a.toolCalls[0].status).toBe('denied');
    const results = toolResultsOf(client.requests.at(-1) as LlmRequest);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('status="denied"');
    expect(view.status).toBe('done');
  });

  it('remembers an approval as a policy but never for danger tools', async () => {
    const scriptFor = (tool: string): StepScript => (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', tool)], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };

    use(teamClient(planOf([step('a')]), { a: scriptFor('change_thing') }));
    let id = await createMission('목표');
    let waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'approve', true);
    await waitForMission(id);
    expect((await getSettings()).toolPolicies.change_thing).toBe('allow');

    use(teamClient(planOf([step('a')]), { a: scriptFor('delete_thing') }));
    id = await createMission('목표');
    waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'approve', true);
    await waitForMission(id);
    expect((await getSettings()).toolPolicies.delete_thing).toBeUndefined();
  });

  it('runs safe calls while an approval from the same turn is pending', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'change_thing'), toolUseBlock('t2', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    const client = use(teamClient(planOf([step('a')]), { a: script }));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    await waitUntil(() => mocks.executeTool.mock.calls.length === 1, '안전한 호출 실행');
    expect(mocks.executeTool.mock.calls[0][0]).toBe('read_thing');
    expect(waiting.steps.a.status).toBe('awaiting_approval');

    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    await waitForMission(id);
    // 결과는 호출 순서대로 하나의 user 메시지에 담긴다.
    expect(toolResultsOf(client.requests.at(-1) as LlmRequest).map((r) => r.tool_use_id)).toEqual(['t1', 't2']);
  });

  it('asks before running the plan when plan review is on, and stops when denied', async () => {
    await patchSettings({ reviewPlans: true });
    const client = use(teamClient(planOf([step('a')])));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(waiting.status).toBe('awaiting_plan');
    expect(waiting.approvals[0].kind).toBe('plan');
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('cancelled');
    expect(client.requests).toHaveLength(1);
  });

  it('rejects an unknown approval id', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'change_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(await decideApproval(id, 'ap_forged', 'approve', false)).toBe(false);
    expect(mocks.executeTool).not.toHaveBeenCalled();
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });
});

describe('least privilege and validation', () => {
  it('blocks a tool the agent was not given, even if the model asks for it', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'archivist_only')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    const client = use(teamClient(planOf([step('a', [], 'writer')]), { a: script }));
    const view = await run();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(view.steps.a.toolCalls[0].status).toBe('blocked');
    const results = toolResultsOf(client.requests.at(-1) as LlmRequest);
    expect(results[0].is_error).toBe(true);
  });

  it('blocks a tool that does not exist', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'hallucinated_tool')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(view.steps.a.toolCalls[0].status).toBe('blocked');
  });

  it('honors a block policy', async () => {
    await setToolPolicy('read_thing', 'block');
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(view.steps.a.toolCalls[0].status).toBe('blocked');
    await setToolPolicy('read_thing', 'default');
  });

  it('rejects invalid input before it reaches an approval card or the tool', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'strict_tool', { n: 'not a number' })], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    const client = use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(view.steps.a.toolCalls[0].status).toBe('error');
    expect(toolResultsOf(client.requests.at(-1) as LlmRequest)[0].is_error).toBe(true);
  });
});

describe('taint', () => {
  const readThenSend: StepScript = (_r, turn) => {
    if (turn === 0) return { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') };
    if (turn === 1) return { message: makeMessage([toolUseBlock('t2', 'send_out')], 'tool_use') };
    return { message: makeMessage([textBlock('ok')]) };
  };

  it('runs egress freely before any untrusted read', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'send_out')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(view.steps.a.tainted).toBe(false);
    expect(mocks.executeTool.mock.calls[0][3]).toMatchObject({ approvedBy: 'auto', tainted: false });
  });

  it('asks before egress after an untrusted read', async () => {
    use(teamClient(planOf([step('a')]), { a: readThenSend }));
    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(waiting.steps.a.tainted).toBe(true);
    expect(waiting.approvals[0]).toMatchObject({ tool: 'send_out', tainted: true });
    expect(mocks.executeTool.mock.calls.map((c) => c[0])).toEqual(['read_thing']);

    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    await waitForMission(id);
    expect(mocks.executeTool.mock.calls[1][3]).toMatchObject({ approvedBy: 'user', tainted: true });
  });

  it('starts a dependent step tainted, so its egress asks too', async () => {
    const reader: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('파일 내용')]) };
    const sender: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t2', 'send_out')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a'), step('b', ['a'], 'writer')]), { a: reader, b: sender }));

    const id = await createMission('목표');
    const waiting = await waitForApproval(id);
    expect(waiting.steps.b.tainted).toBe(true);
    expect(waiting.approvals[0]).toMatchObject({ stepId: 'b', tool: 'send_out', tainted: true });
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(id);
  });

  it('does not taint from a tool that failed', async () => {
    mocks.executeTool.mockImplementation(async () => ({ status: 'error', content: '실패', auditId: 'a' }));
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(view.steps.a.tainted).toBe(false);
  });

  it('carries taint into a follow-up, whose context quotes earlier outside content', async () => {
    const reader: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('파일 내용')]) };
    use(teamClient(planOf([step('a')]), { a: reader }));
    const first = await run();
    expect(first.steps.a.tainted).toBe(true);

    const sender: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t2', 'send_out')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('b')]), { b: sender }));
    await followupMission(first.id, '이어서 내보내줘');
    const waiting = await waitForApproval(first.id);
    expect(waiting.approvals[0]).toMatchObject({ tool: 'send_out', tainted: true });
    await decideApproval(first.id, waiting.approvals[0].id, 'deny', false);
    await waitForMission(first.id);
  });

  it('marks a step tainted when it uses a web tool', async () => {
    const { serverToolBlock, webSearchResultBlock } = await import('./helpers');
    const script: StepScript = () => ({
      message: makeMessage([serverToolBlock('srv1', 'web_search', { query: 'x' }), webSearchResultBlock('srv1'), textBlock('찾음')]),
    });
    use(teamClient(planOf([step('a', [], 'researcher')]), { a: script }));
    const view = await run();
    expect(view.steps.a.tainted).toBe(true);
    expect(view.steps.a.toolCalls[0]).toMatchObject({ name: 'web_search', serverSide: true, status: 'ok' });
  });
});

describe('budget', () => {
  it('stops new work once the budget is spent, keeps partial output, and does not synthesize', async () => {
    await patchSettings({ budgetUsd: 0.05 });
    const expensive = { input_tokens: 10, output_tokens: 3000 };
    const client = new FakeClient((request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) {
        return { message: makeMessage([textBlock(JSON.stringify(planOf([step('a'), step('b', ['a'])])))], 'end_turn', expensive) };
      }
      return { message: makeMessage([textBlock('never')]) };
    });
    use(client);
    const view = await run();
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('budget_exceeded');
    expect(view.steps.a.status).toBe('failed');
    expect(view.steps.b.status).toBe('skipped');
    // 계획 호출 후에는 어떤 모델 호출도 하지 않는다.
    expect(client.requests).toHaveLength(1);
  });

  it('does not start synthesis after a step spends the budget', async () => {
    await patchSettings({ budgetUsd: 0.05 });
    const costly: StepScript = () => ({
      message: makeMessage([textBlock('부분 결과')], 'end_turn', { input_tokens: 10, output_tokens: 3000 }),
    });
    const client = use(teamClient(planOf([step('a'), step('b', ['a'])]), { a: costly }));
    const view = await run();
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('budget_exceeded');
    expect(view.steps.a.status).toBe('done');
    expect(view.steps.a.output).toBe('부분 결과');
    expect(client.requests.some((r) => r.system === CONDUCTOR_SYNTH_SYSTEM)).toBe(false);
  });

  it('gives a follow-up its own budget', async () => {
    // 계획은 싸고 답변이 $0.06이다. 첫 턴(계획 + 답변)이 끝나면 누적 비용이 상한을 넘는다.
    await patchSettings({ budgetUsd: 0.05 });
    const client = new FakeClient((request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) {
        return { message: makeMessage([textBlock(JSON.stringify({ title: 't', route: 'answer', rationale: '', steps: [] }))], 'end_turn', { input_tokens: 30, output_tokens: 20 }) };
      }
      return { message: makeMessage([textBlock('답')], 'end_turn', { input_tokens: 30, output_tokens: 3000 }) };
    });
    use(client);
    const first = await run();
    expect(first.status).toBe('done');
    expect(first.usage.costUsd).toBeGreaterThan(first.budgetUsd);

    await followupMission(first.id, '이어서');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.status).toBe('done');
    expect(second.usage.costUsd).toBeGreaterThan(first.usage.costUsd);
  });
});

describe('cancel', () => {
  it('cancels during an approval, resolving it as denied without running the tool', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'change_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a'), step('b', ['a'])]), { a: script }));
    const id = await createMission('목표');
    await waitForApproval(id);

    expect(await cancelOrDeleteMission(id)).toBe(true);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('cancelled');
    expect(view.approvals).toEqual([]);
    expect(view.steps.a.status).toBe('cancelled');
    expect(view.steps.b.status).toBe('cancelled');
    expect(view.steps.a.toolCalls[0].status).toBe('denied');
    expect(mocks.executeTool).not.toHaveBeenCalled();
    const events = await loadEvents(id);
    expect(events.some((e) => e.type === 'approval.resolved' && e.decision === 'deny')).toBe(true);
  });

  it('aborts a running model stream', async () => {
    const hang = deferred();
    const seen: AbortSignal[] = [];
    const inner = teamClient(planOf([step('a')]), { a: () => ({ wait: hang.promise, message: makeMessage([textBlock('never')]) }) });
    setClientFactory(() => ({
      stream(req, signal) {
        seen.push(signal);
        return inner.stream(req, signal);
      },
    }));
    const id = await createMission('목표');
    await waitUntil(async () => (await getMissionView(id))?.steps.a?.status === 'running', '단계 시작');
    await cancelOrDeleteMission(id);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('cancelled');
    expect(seen.every((s) => s.aborted)).toBe(true);
  });

  it('deletes a finished mission on the second call', async () => {
    use(teamClient({ title: 't', route: 'answer', steps: [] }));
    const view = await run();
    expect(await cancelOrDeleteMission(view.id)).toBe(true);
    expect(await getMissionView(view.id)).toBeNull();
    expect((await listMissionSummaries()).some((s) => s.id === view.id)).toBe(false);
  });
});

describe('persistence', () => {
  it('rebuilds the same view by replaying the persisted events', async () => {
    const script: StepScript = (_r, turn) =>
      turn === 0
        ? { message: makeMessage([toolUseBlock('t1', 'read_thing')], 'tool_use') }
        : { message: makeMessage([textBlock('ok')]) };
    use(teamClient(planOf([step('a', [], 'archivist'), step('b', ['a'], 'writer')]), { a: script }));
    const live = await run();
    const events = await loadEvents(live.id);
    expect(events[0].type).toBe('mission.created');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(replayEvents(events)).toEqual(live);
  });

  it('marks unfinished missions failed after a restart', async () => {
    const id = 'm_orphan1';
    const lines = [
      { seq: 1, at: 1000, type: 'mission.created', id, goal: '이전 미션', mode: 'live', budgetUsd: 2 },
      { seq: 2, at: 1001, type: 'mission.status', status: 'running' },
    ];
    await appendLine(dataPath('missions', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
    resetMissionRegistryForTests();

    const summaries = await listMissionSummaries();
    expect(summaries.find((s) => s.id === id)?.status).toBe('failed');
    const view = await getMissionView(id);
    expect(view?.status).toBe('failed');
    expect(view?.error?.message).toContain('다시 시작');
    const events = await loadEvents(id);
    expect(events.at(-1)?.type).toBe('mission.finished');
    // 클라이언트가 이미 본 seq와 겹치지 않도록 크게 건너뛴다.
    expect(events.map((e) => e.seq)).toEqual([1, 2, 1003, 1004]);
  });

  it('ignores a truncated last line', async () => {
    const id = 'm_truncated1';
    const good = JSON.stringify({ seq: 1, at: 1, type: 'mission.created', id, goal: 'g', mode: 'live', budgetUsd: 2 });
    await appendLine(dataPath('missions', `${id}.jsonl`), `${good}\n{"seq":2,"at":`);
    expect((await loadEvents(id))).toHaveLength(1);
  });

  it('refuses ids that could escape the data directory', async () => {
    expect(await getMissionView('../secrets')).toBeNull();
    expect(await cancelOrDeleteMission('..\\settings')).toBe(false);
    expect(await decideApproval('../x', 'ap', 'approve', false)).toBe(false);
  });
});

describe('errors and validation', () => {
  it('validates the goal', async () => {
    await expect(createMission('   ')).rejects.toMatchObject({ code: 'invalid_goal' });
    await expect(createMission(123)).rejects.toMatchObject({ code: 'invalid_goal' });
    await expect(createMission('x'.repeat(MAX_GOAL_CHARS + 1))).rejects.toMatchObject({ code: 'goal_too_long' });
  });

  it.each([
    [new Anthropic.AuthenticationError(401, {}, 'x', new Headers()), 'invalid_api_key'],
    [new Anthropic.RateLimitError(429, {}, 'x', new Headers()), 'rate_limited'],
    [new Anthropic.InternalServerError(529, {}, 'x', new Headers()), 'overloaded'],
    [new Anthropic.APIConnectionError({ message: 'x' }), 'network'],
    [new Error('secret internal detail sk-ant-123'), 'internal'],
  ])('maps planning errors to a code without leaking details', async (error, code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    use(new FakeClient(() => ({ error })));
    const view = await run();
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe(code);
    expect(view.error?.message).not.toContain('sk-ant');
    expect(view.error?.message).not.toContain('secret internal');
    spy.mockRestore();
  });

  it('surfaces a refusal from a step as the refused code', async () => {
    const script: StepScript = () => ({ message: makeMessage([toolUseBlock('t1', 'change_thing')], 'refusal') });
    use(teamClient(planOf([step('a')]), { a: script }));
    const view = await run();
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('refused');
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it('limits how many missions run at once', async () => {
    const hang = deferred();
    use(new FakeClient(() => ({ wait: hang.promise, message: makeMessage([textBlock('{}')]) })));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createMission(`목표 ${i}`));
    await expect(createMission('하나 더')).rejects.toMatchObject({ code: 'too_many_missions' });
    await Promise.all(ids.map((id) => cancelOrDeleteMission(id)));
    await Promise.all(ids.map((id) => waitForMission(id)));
  });
});

describe('follow-up', () => {
  it('carries earlier turns as context and keeps seq monotonic', async () => {
    const client = use(teamClient({ title: 't', route: 'answer', steps: [] }, {}, '첫 답변'));
    const first = await run('첫 질문');
    await followupMission(first.id, '두 번째 질문');
    const second = (await waitForMission(first.id)) as MissionView;
    expect(second.turns).toEqual([{ goal: '첫 질문', at: expect.any(Number), answer: '첫 답변' }]);
    expect(second.goal).toBe('두 번째 질문');
    const planning = client.requests.filter((r) => r.system === CONDUCTOR_PLAN_SYSTEM).at(-1) as LlmRequest;
    expect(planning.messages[0].content).toContain('첫 질문');
    expect(planning.messages[0].content).toContain('첫 답변');
    const events = await loadEvents(first.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(replayEvents(events)).toEqual(second);
  });

  it('refuses a follow-up while the mission is still running', async () => {
    const hang = deferred();
    use(new FakeClient(() => ({ wait: hang.promise, message: makeMessage([textBlock('{}')]) })));
    const id = await createMission('목표');
    await expect(followupMission(id, '이어서')).rejects.toMatchObject({ code: 'mission_active' });
    await cancelOrDeleteMission(id);
    await waitForMission(id);
  });

  it('returns false for an unknown mission', async () => {
    expect(await followupMission('m_nothere', '이어서')).toBe(false);
  });
});

describe('demo mode', () => {
  beforeEach(() => {
    mocks.apiKey = null;
    process.env.ILLIONAIRE_DEMO_SPEED = '500';
  });
  afterEach(() => {
    delete process.env.ILLIONAIRE_DEMO_SPEED;
  });

  it('plays a team mission with a real approval pause and touches nothing', async () => {
    const factory = vi.fn(() => {
      throw new Error('데모는 모델을 호출하면 안 돼요');
    });
    setClientFactory(factory);
    const id = await createMission('경쟁 제품 가격을 조사해서 보고서로 써줘');
    const waiting = await waitForApproval(id);
    expect(waiting.mode).toBe('demo');
    expect(waiting.status).toBe('awaiting_approval');
    expect(waiting.plan?.steps.length).toBeGreaterThan(1);
    // 병렬 갈래가 있는 계획이다.
    expect(waiting.plan?.steps.filter((s) => s.dependsOn.length === 0).length).toBeGreaterThan(1);
    expect(waiting.steps.s1.tainted).toBe(true);
    expect(waiting.steps.s4.tainted).toBe(true);

    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toContain('데모');
    expect(view.usage.costUsd).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.recordDenied).not.toHaveBeenCalled();
    expect(replayEvents(await loadEvents(id))).toEqual(view);
  });

  it('says when an approval was denied', async () => {
    const id = await createMission('다운로드 폴더 정리해줘');
    const waiting = await waitForApproval(id);
    expect(waiting.approvals[0].risk).toBe('danger');
    await decideApproval(id, waiting.approvals[0].id, 'deny', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toContain('거부');
    expect(view.answer).toContain('데모');
  });

  it('plays the week plan', async () => {
    const id = await createMission('이번 주 계획 세워줘');
    const waiting = await waitForApproval(id);
    await decideApproval(id, waiting.approvals[0].id, 'approve', false);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('done');
    expect(view.answer).toContain('데모');
  });

  it('answers anything else directly and says it is a demo', async () => {
    const view = await run('안녕');
    expect(view.status).toBe('done');
    expect(view.plan?.route).toBe('answer');
    expect(view.answer).toContain('데모');
  });

  it('can be cancelled', async () => {
    const id = await createMission('이번 주 계획 세워줘');
    await waitForApproval(id);
    await cancelOrDeleteMission(id);
    const view = (await waitForMission(id)) as MissionView;
    expect(view.status).toBe('cancelled');
  });
});
