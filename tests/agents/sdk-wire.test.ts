import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '@/lib/agents/agent-loop';
import { BudgetExceededError, describeError } from '@/lib/agents/errors';
import { createClient, type ToolResultBlockParam, type ToolUseBlock } from '@/lib/agents/llm';
import { createMission, resetMissionRegistryForTests, waitForMission } from '@/lib/agents/mission';
import { CONDUCTOR_PLAN_SYSTEM, CONDUCTOR_SYNTH_SYSTEM, SPECIALISTS } from '@/lib/agents/roster';
import { dataPath, writeJson } from '@/lib/store/json';
import { patchSettings } from '@/lib/store/settings';
import { validateInput } from '@/lib/tools/validate';
import type { MissionView } from '@/lib/contracts';
import '@/lib/tools';
import { waitUntil } from './helpers';

/**
 * 실제 SDK를 그대로 쓰고 API 서버만 흉내 낸다. 실제 키 없이 요청 본문과 헤더,
 * 스트림 파싱, 타입별 오류가 실제 SDK 경로에서 동작하는지 검증한다.
 */
vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => 'sk-ant-test' }));

interface Recorded {
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const recorded: Recorded[] = [];
let responder: (body: Record<string, unknown>, index: number) => Reply = () => ({ status: 500, json: {} });
let server: Server;

/** hold: 스트림을 끝내지 않는다. 클라이언트가 끊을 때까지 열어 둔다. delayMs: 응답을 끝내기 전에 기다린다. */
type Reply = { status: number; json: unknown } | { sse: unknown[]; cut?: boolean; hold?: boolean; delayMs?: number };

/** 지금 열려 있는 스트리밍 요청 수. 동시 호출과 끊김을 서버 쪽에서 본다. */
const wire = { open: 0, maxOpen: 0, disconnected: 0 };

function fallbackEvents(index: number, category = 'cyber'): unknown[] {
  return [
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal', category } },
    },
    { type: 'content_block_stop', index },
  ];
}

function serverUseEvents(index: number, id: string, name: string, json: string): unknown[] {
  return [
    { type: 'content_block_start', index, content_block: { type: 'server_tool_use', id, name, input: {} } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } },
    { type: 'content_block_stop', index },
  ];
}

function usage(extra: object = {}) {
  return { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...extra };
}

function messageStart(model = 'claude-opus-5-5') {
  return {
    type: 'message_start',
    message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: usage() },
  };
}

function messageEnd(stopReason: string) {
  return [
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

function textTurn(text: string, stopReason = 'end_turn', thinking?: string): unknown[] {
  const blocks: unknown[] = [];
  let index = 0;
  if (thinking) {
    blocks.push(
      { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig-abc' } },
      { type: 'content_block_stop', index }
    );
    index++;
  }
  blocks.push(
    { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index }
  );
  return [messageStart(), ...blocks, ...messageEnd(stopReason)];
}

function toolTurn(id: string, name: string, partialJson: string, thinking?: string): unknown[] {
  const blocks: unknown[] = [];
  let index = 0;
  if (thinking) {
    blocks.push(
      { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig-tool' } },
      { type: 'content_block_stop', index }
    );
    index++;
  }
  blocks.push(
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } },
    { type: 'content_block_stop', index }
  );
  return [messageStart(), ...blocks, ...messageEnd('tool_use')];
}

beforeAll(async () => {
  process.env.ILLIONAIRE_RETRY_DELAY_MS = '0';
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      recorded.push({ headers: req.headers, body });
      const reply = responder(body, recorded.length - 1);
      if ('sse' in reply) {
        wire.open++;
        wire.maxOpen = Math.max(wire.maxOpen, wire.open);
        let finished = false;
        res.on('close', () => {
          wire.open--;
          if (!finished) wire.disconnected++;
        });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of reply.sse) {
          res.write(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        if (reply.hold) return;
        if (reply.cut) {
          setTimeout(() => res.destroy(), 20);
          return;
        }
        setTimeout(() => {
          finished = true;
          res.end();
        }, reply.delayMs ?? 0);
      } else {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.json));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  recorded.length = 0;
  Object.assign(wire, { open: 0, maxOpen: 0, disconnected: 0 });
  await patchSettings({ budgetUsd: 100, reviewPlans: false, toolPolicies: {}, modelPreset: 'best' });
  resetMissionRegistryForTests();
});

function loopInput(model = 'claude-opus-5-5') {
  return {
    client: createClient('sk-ant-test'),
    model,
    effort: 'medium' as const,
    maxTokens: 64000,
    system: 'frozen system',
    tools: [],
    messages: [{ role: 'user' as const, content: 'hello' }],
    signal: new AbortController().signal,
    hooks: {
      beforeModelCall: () => undefined,
      onUsage: () => undefined,
      onThinking: () => undefined,
      onText: () => undefined,
      onActivity: () => undefined,
      onServerToolStart: () => undefined,
      onServerToolFinish: () => undefined,
      runClientTools: async () => [],
    },
  };
}

describe('the cost cap on the wire', () => {
  const writers = (tasks: string[]) => ({
    title: '병렬 작성',
    route: 'team',
    rationale: '',
    steps: tasks.map((task, i) => ({ id: `s${i}`, agent: 'writer', title: `단계${i}`, task, dependsOn: [] })),
  });
  const isWriter = (body: Record<string, unknown>) => body.system === SPECIALISTS.writer.system;

  function startWith(inputTokens: number) {
    return {
      type: 'message_start',
      message: { id: 'msg_w', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: usage({ input_tokens: inputTokens, output_tokens: 1 }) },
    };
  }

  it('sends three cheap parallel calls at once, on a budget where the full max_tokens of even two would not fit', async () => {
    await patchSettings({ budgetUsd: 2 });
    responder = (body) =>
      body.system === CONDUCTOR_PLAN_SYSTEM
        ? { sse: textTurn(JSON.stringify(writers(['가', '나', '다']))) }
        : isWriter(body)
          ? { sse: textTurn('끝'), delayMs: 40 }
          : { sse: textTurn('종합') };
    const view = (await waitForMission(await createMission('세 가지 써줘'))) as MissionView;
    expect(view.status).toBe('done');
    expect(wire.maxOpen).toBe(3);
  });

  it('holds back a parallel call whose estimated input does not fit, then runs it once real usage settles', async () => {
    // 기억 200개면 10만 자다. 호출마다 입력을 약 $0.23, 출력 몫 $0.08을 예약해 상한 $0.8에는 두 개만 들어간다.
    // 지시문을 늘리면 안 된다. 계획 자체가 그만큼의 출력 비용이 되어 먼저 끊긴다.
    await patchSettings({ budgetUsd: 0.8 });
    const now = Date.now();
    const memory = Array.from({ length: 200 }, (_, i) => ({ id: `mem_${i}`, text: 'ㄱ'.repeat(500), source: 'user', createdAt: now }));
    await writeJson(dataPath('memory.json'), memory);
    responder = (body) =>
      body.system === CONDUCTOR_PLAN_SYSTEM
        ? { sse: textTurn(JSON.stringify(writers(['가', '나', '다']))) }
        : isWriter(body)
          ? { sse: textTurn('끝'), delayMs: 60 }
          : { sse: textTurn('종합') };
    try {
      const view = (await waitForMission(await createMission('세 가지 써줘'))) as MissionView;
      expect(wire.maxOpen).toBe(2);
      // 실제 비용은 적었으므로 세 번째도 결국 돌고 미션은 끝난다.
      expect(recorded.filter((r) => isWriter(r.body))).toHaveLength(3);
      expect(view.status).toBe('done');
    } finally {
      await writeJson(dataPath('memory.json'), []);
    }
  });

  it('refuses a call that cannot fit, in the failure mode the UI already handles, before anything is sent', async () => {
    // 계획에 $0.04를 쓰면 상한 $0.05에는 다음 호출의 예약이 들어가지 않는다.
    await patchSettings({ budgetUsd: 0.05 });
    responder = (body) =>
      body.system === CONDUCTOR_PLAN_SYSTEM
        ? { sse: [startWith(10_000), ...textTurn(JSON.stringify(writers(['가']))).slice(1)] }
        : { sse: textTurn('끝') };
    const view = (await waitForMission(await createMission('써줘'))) as MissionView;
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('budget_exceeded');
    expect(view.steps.s0.status).toBe('failed');
    expect(recorded.filter((r) => isWriter(r.body))).toHaveLength(0);
    expect(view.usage.costUsd).toBeLessThanOrEqual(0.05);
    expect(describeError(new BudgetExceededError(0.05)).message).toContain('상한');
  });

  it('cuts live streams once real input pushes the mission past the cap, and the server sees the disconnect', async () => {
    // 지시는 짧아 예약은 통과하지만 실제 입력은 12만 토큰($0.48)씩이다. 셋이면 $1.44로 상한 $1을 넘는다.
    await patchSettings({ budgetUsd: 1 });
    responder = (body) =>
      body.system === CONDUCTOR_PLAN_SYSTEM
        ? { sse: textTurn(JSON.stringify(writers(['가', '나', '다']))) }
        : { sse: [startWith(120_000), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }], hold: true };
    const view = (await waitForMission(await createMission('세 가지 써줘'))) as MissionView;
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('budget_exceeded');
    await waitUntil(() => wire.disconnected >= 2, '서버 쪽 끊김');
    // 입력 추정이 빗나가면 넘을 수는 있다. 그래도 호출들의 실제 입력 합을 넘지 않고, 그 뒤로 새 호출도 없다.
    expect(view.usage.costUsd).toBeGreaterThan(1);
    expect(view.usage.costUsd).toBeLessThan(1.5);
    expect(recorded.filter((r) => r.body.system === CONDUCTOR_SYNTH_SYSTEM)).toHaveLength(0);
  });

  it('counts failed-after-cut usage only once', async () => {
    await patchSettings({ budgetUsd: 1 });
    responder = (body) =>
      body.system === CONDUCTOR_PLAN_SYSTEM
        ? { sse: textTurn(JSON.stringify(writers(['가']))) }
        : { sse: [startWith(300_000)], hold: true };
    const view = (await waitForMission(await createMission('써줘'))) as MissionView;
    expect(view.error?.code).toBe('budget_exceeded');
    // 계획 호출의 몇 토큰을 뺀 입력 30만 토큰 = $1.20 한 번.
    expect(view.usage.costUsd).toBeCloseTo(1.2, 2);
  });
});

describe('the real SDK on the wire', () => {
  it('sends the documented request shape', async () => {
    responder = () => ({ sse: textTurn('안녕') });
    const result = await runAgentLoop(loopInput());
    expect(result.text).toBe('안녕');

    const { headers, body } = recorded[0];
    expect(headers.authorization).toBe('Bearer sk-ant-test');
    expect(headers['anthropic-version']).toBe('2026-10-21');
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(headers['anthropic-beta']).toContain('thinking-binding-controls-2026-08-01');
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      stream: true,
      system: 'frozen system',
      thinking: { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
    });
    // betas는 헤더로 나가야 하고 본문에 남으면 안 된다.
    expect(body).not.toHaveProperty('betas');
    for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
      expect(body).not.toHaveProperty(banned);
    }
  });

  it('sends no fallback on Haiku', async () => {
    responder = () => ({ sse: textTurn('안녕') });
    await runAgentLoop(loopInput('claude-haiku-5-5'));
    const { headers, body } = recorded[0];
    expect(String(headers['anthropic-beta'] ?? '')).not.toContain('server-side-fallback');
    expect(String(headers['anthropic-beta'] ?? '')).toContain('thinking-binding-controls-2026-08-01');
    expect(body).not.toHaveProperty('fallbacks');
  });

  it('raises typed errors the mapper recognizes, without retrying a 401', async () => {
    responder = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    await expect(runAgentLoop(loopInput())).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    expect(recorded).toHaveLength(1);
  });

  it('hands back truncated tool input from the tolerant parser, so validation before running is required', async () => {
    responder = (_body, index) =>
      index === 0 ? { sse: toolTurn('t1', 'write_file', '{"path": "unterminated') } : { sse: textTurn('끝') };
    const input = loopInput();
    const seen: unknown[] = [];
    const runClientTools = vi.fn(async (blocks: ToolUseBlock[]) => {
      seen.push(...blocks.map((b) => b.input));
      return blocks.map((b): ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: b.id, content: 'x', is_error: true }));
    });
    await runAgentLoop({ ...input, hooks: { ...input.hooks, runClientTools } });

    // 이 SDK는 잘린 JSON에 예외를 던지지 않고 일부만 담긴 객체를 준다. 필수 필드 검증이 이를 막는다.
    const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false };
    expect(() => validateInput(schema, seen[0])).toThrow();
  });

  it('sanitizes a mid-stream fallback and runs only the fallback model tool call', async () => {
    responder = (_body, index) =>
      index === 0
        ? {
            sse: [
              messageStart(),
              { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'declined' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sigA' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_declined', name: 'write_file', input: {} } },
              { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"C:/x.txt","content":"par' } },
              { type: 'content_block_stop', index: 1 },
              ...fallbackEvents(2),
              { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_fallback', name: 'list_files', input: {} } },
              { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"path":"~"}' } },
              { type: 'content_block_stop', index: 3 },
              ...messageEnd('tool_use'),
            ],
          }
        : { sse: textTurn('끝') };
    const input = loopInput();
    const runClientTools = vi.fn(async (blocks: ToolUseBlock[]) =>
      blocks.map((b): ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: b.id, content: 'ok' }))
    );
    await runAgentLoop({ ...input, hooks: { ...input.hooks, runClientTools } });

    expect(runClientTools.mock.calls[0][0].map((b) => b.id)).toEqual(['toolu_fallback']);
    const messages = recorded[1].body.messages as Array<{ role: string; content: Array<{ type: string; id?: string; tool_use_id?: string }> }>;
    expect(messages[1].content.map((b) => [b.type, b.id ?? ''])).toEqual([
      ['fallback', ''],
      ['tool_use', 'toolu_fallback'],
    ]);
    expect(messages[2].content.map((b) => b.tool_use_id)).toEqual(['toolu_fallback']);
  });

  it('resumes pause_turn with the container and keeps text from before the pause', async () => {
    responder = (_body, index) =>
      index === 0
        ? {
            sse: [
              messageStart(),
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'FIRST ' } },
              { type: 'content_block_stop', index: 0 },
              ...serverUseEvents(1, 'srvtoolu_1', 'code_execution', '{"code":"print(1)"}'),
              {
                type: 'message_delta',
                delta: { stop_reason: 'pause_turn', stop_sequence: null, container: { id: 'container_abc', expires_at: '2030-01-01T00:00:00Z' } },
                usage: { output_tokens: 5 },
              },
              { type: 'message_stop' },
            ],
          }
        : { sse: textTurn('SECOND') };
    const result = await runAgentLoop(loopInput());
    expect(result.text).toBe('FIRST SECOND');
    expect(recorded[0].body).not.toHaveProperty('container');
    expect(recorded[1].body.container).toBe('container_abc');
    const roles = (recorded[1].body.messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant']);
  });

  it('does not treat a dropped connection as bad tool JSON', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    responder = (_body, index) => ({ sse: [messageStart(), ...textTurn(`partial${index} `).slice(1, 4)], cut: true });
    const text: string[] = [];
    const rollbacks: number[] = [];
    const input = loopInput();
    const err = await runAgentLoop({
      ...input,
      hooks: { ...input.hooks, onText: (d) => text.push(d), onRollback: ({ text: n }) => rollbacks.push(n) },
    }).catch((e) => e);
    expect(describeError(err).code).toBe('network');
    expect(recorded).toHaveLength(3);
    expect(rollbacks).toEqual([9, 9]);
    log.mockRestore();
  });

  it('classifies mid-stream SSE errors by type and retries only the overload', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    responder = () => ({ sse: [messageStart(), { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }] });
    const limited = await runAgentLoop(loopInput()).catch((e) => e);
    expect(describeError(limited).code).toBe('rate_limited');
    expect(recorded).toHaveLength(1);

    recorded.length = 0;
    responder = () => ({ sse: [messageStart(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }] });
    const overloaded = await runAgentLoop(loopInput()).catch((e) => e);
    expect(describeError(overloaded).code).toBe('overloaded');
    expect(recorded).toHaveLength(3);

    recorded.length = 0;
    responder = (_b, i) =>
      i === 0 ? { sse: [messageStart(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }] } : { sse: textTurn('됐어요') };
    expect((await runAgentLoop(loopInput())).text).toBe('됐어요');
    log.mockRestore();
  });

  it.each([
    [400, 'invalid_request_error'],
    [404, 'not_found_error'],
    [413, 'request_too_large'],
  ])('surfaces a real %i with its API message', async (status, type) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    responder = () => ({ status, json: { type: 'error', error: { type, message: `boom ${type}` } } });
    const described = describeError(await runAgentLoop(loopInput()).catch((e) => e));
    expect(described.message).toContain(String(status));
    expect(described.message).toContain(`boom ${type}`);
    log.mockRestore();
  });

  it('accepts the token usage of a server-side fallback from the final message_delta', async () => {
    const onUsage = vi.fn();
    responder = () => ({
      sse: [
        messageStart(),
        ...fallbackEvents(0),
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '답' } },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: {
            output_tokens: 0,
            iterations: [
              { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
              { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            ],
          },
        },
        { type: 'message_stop' },
      ],
    });
    const input = loopInput();
    await runAgentLoop({ ...input, hooks: { ...input.hooks, onUsage } });
    // 출력 전 cyber 거절은 청구되지 않는다. 이어 받은 Opus 5의 입력만 청구된다.
    expect(onUsage.mock.calls[0][1].costUsd).toBeCloseTo(5);
  });

  it('runs a whole mission and echoes thinking with its signature on the next turn', async () => {
    const plan = {
      title: '시간 확인',
      route: 'team',
      rationale: '시계를 봐요.',
      steps: [{ id: 's1', agent: 'planner', title: '시간 확인', task: '지금 시각을 알려주세요.', dependsOn: [] }],
    };
    responder = (body) => {
      if (body.system === CONDUCTOR_PLAN_SYSTEM) return { sse: textTurn(JSON.stringify(plan), 'end_turn', '계획을 세워요') };
      const messages = body.messages as unknown[];
      return messages.length === 1
        ? { sse: toolTurn('toolu_1', 'get_current_time', '{}', '시계를 볼게요') }
        : { sse: textTurn('지금은 오전이에요.', 'end_turn') };
    };

    const id = await createMission('지금 몇 시야');
    const view = (await waitForMission(id)) as MissionView;
    expect(view.error).toBeUndefined();
    expect(view.status).toBe('done');
    expect(view.answer).toBe('지금은 오전이에요.');
    expect(view.conductorThinking).toBe('계획을 세워요');
    expect(view.steps.s1.thinking).toBe('시계를 볼게요');
    expect(view.steps.s1.toolCalls[0]).toMatchObject({ name: 'get_current_time', status: 'ok' });
    expect(view.usage.costUsd).toBeGreaterThan(0);

    const planCall = recorded.find((r) => r.body.system === CONDUCTOR_PLAN_SYSTEM) as Recorded;
    expect(planCall.body.max_tokens).toBe(32000);
    expect((planCall.body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(planCall.body).not.toHaveProperty('tools');

    const stepCalls = recorded.filter((r) => r.body.system === SPECIALISTS.planner.system);
    expect(stepCalls).toHaveLength(2);
    const tools = stepCalls[0].body.tools as Array<{ name: string; eager_input_streaming?: boolean }>;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);

    const second = stepCalls[1].body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(second[0]).toEqual((stepCalls[0].body.messages as unknown[])[0]);
    expect(second[1].role).toBe('assistant');
    expect(second[1].content[0]).toEqual({ type: 'thinking', thinking: '시계를 볼게요', signature: 'sig-tool' });
    expect(second[1].content[1]).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'get_current_time', input: {} });
    expect(second[2].role).toBe('user');
    expect(second[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(String(second[2].content[0].content)).toContain('<tool_output tool="get_current_time" status="ok">');
  });
});
