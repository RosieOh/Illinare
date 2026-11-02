import { describe, expect, it, vi } from 'vitest';
import { estimateTokens, runAgentLoop } from '@/lib/agents/agent-loop';
import { BudgetGuard, type CallEstimate } from '@/lib/agents/budget';
import { BudgetExceededError, CancelledError } from '@/lib/agents/errors';
import type { LlmClient, MessageParam, StreamEvent } from '@/lib/agents/llm';
import { costOf, estimateInputUsd, outputUsdPerToken } from '@/lib/agents/pricing';
import { FakeClient, makeMessage, serverToolBlock, textBlock, toolUseBlock, webSearchResultBlock } from './helpers';

const OPUS = 'claude-opus-5-5';
/** Opus 호출 하나의 현실적인 예약: 입력 4,000토큰 + 출력 4,000토큰 */
const opusCall: CallEstimate = { inputUsd: estimateInputUsd(OPUS, 4000, 0), outputAllowanceUsd: 4000 * outputUsdPerToken(OPUS) };
const signal = () => new AbortController().signal;

function guard(limit: number, spent = { usd: 0 }) {
  return { budget: new BudgetGuard(limit, () => spent.usd), spent };
}

/** 약속이 곧바로 풀리는지 본다. 기다리는 호출과 구분하기 위해 쓴다. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  await new Promise((r) => setTimeout(r, 10));
  return settled;
}

describe('reservations', () => {
  it('lets five concurrent Opus calls start on a $2 mission: only a modest share is reserved', async () => {
    const { budget } = guard(2);
    const tickets = await Promise.all(Array.from({ length: 5 }, () => budget.acquire(signal(), { estimate: opusCall, parallelism: 5 })));
    expect(tickets).toHaveLength(5);
    // 전체 max_tokens를 예약했다면 호출 하나가 $1.28이라 두 개째부터 막힌다.
    expect(64_000 * outputUsdPerToken(OPUS)).toBeCloseTo(1.28);
  });

  it('holds a call back while outstanding reservations leave no room', async () => {
    const { budget } = guard(1);
    const big: CallEstimate = { inputUsd: 0.35, outputAllowanceUsd: 0.1 };
    const a = await budget.acquire(signal(), { estimate: big, parallelism: 3 });
    const b = await budget.acquire(signal(), { estimate: big, parallelism: 3 });
    const third = budget.acquire(signal(), { estimate: big, parallelism: 3 });
    expect(await isSettled(third)).toBe(false);

    // 앞선 호출이 실제로는 적게 썼다면 정산으로 자리가 생긴다.
    a.release();
    await expect(third).resolves.toBeTruthy();
    b.release();
  });

  it('settles against real usage: a call that spent its reservation leaves no room for the next', async () => {
    const { budget, spent } = guard(1);
    const big: CallEstimate = { inputUsd: 0.4, outputAllowanceUsd: 0.1 };
    const a = await budget.acquire(signal(), { estimate: big });
    const b = await budget.acquire(signal(), { estimate: big });
    const third = budget.acquire(signal(), { estimate: big });
    spent.usd += 0.6;
    a.release();
    spent.usd += 0.45;
    b.release();
    await expect(third).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('refuses when alone and the call cannot fit, with nothing to wait for', async () => {
    const { budget } = guard(0.1);
    await expect(budget.acquire(signal(), { estimate: { inputUsd: 0.2, outputAllowanceUsd: 0 } })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('refuses when spent plus the reservation would pass the cap', async () => {
    const { budget } = guard(2, { usd: 1.95 });
    await expect(budget.acquire(signal(), { estimate: opusCall })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('caps the output allowance so the smallest budget can still run a small call', async () => {
    const { budget } = guard(0.05);
    const ticket = await budget.acquire(signal(), { estimate: { inputUsd: 0.01, outputAllowanceUsd: 4000 * outputUsdPerToken(OPUS) } });
    expect(ticket).toBeTruthy();
  });

  it('behaves as before for a caller with no estimate', async () => {
    const { budget, spent } = guard(1);
    const ticket = await budget.acquire(signal());
    ticket.release();
    spent.usd = 1;
    await expect(budget.acquire(signal())).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('takes the input estimate and other reservations out of what a call may spend on output', async () => {
    const { budget } = guard(1);
    const est: CallEstimate = { inputUsd: 0.1, outputAllowanceUsd: 0.1 };
    const a = await budget.acquire(signal(), { estimate: est, parallelism: 2 });
    expect(a.maxOutputUsd).toBeCloseTo((1 - 0.1) / 2);
    const b = await budget.acquire(signal(), { estimate: est, parallelism: 2 });
    expect(b.maxOutputUsd).toBeCloseTo((1 - 0.2 - 0.1) / 2);
  });

  it('counts live usage instead of the reservation once it is larger', async () => {
    const { budget } = guard(1);
    const a = await budget.acquire(signal(), { estimate: { inputUsd: 0.01, outputAllowanceUsd: 0.01 } });
    a.update(0.7);
    const next = budget.acquire(signal(), { estimate: { inputUsd: 0.2, outputAllowanceUsd: 0.2 } });
    expect(await isSettled(next)).toBe(false);
    a.release();
    await expect(next).resolves.toBeTruthy();
  });

  it('stops waiting when the mission is cancelled', async () => {
    const { budget } = guard(1);
    await budget.acquire(signal(), { estimate: { inputUsd: 0.9, outputAllowanceUsd: 0 } });
    const controller = new AbortController();
    const waiting = budget.acquire(controller.signal, { estimate: { inputUsd: 0.5, outputAllowanceUsd: 0 } });
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(CancelledError);
  });
});

describe('stopping in-flight streams', () => {
  it('aborts as soon as live usage passes the cap, not at 110%', async () => {
    const { budget } = guard(1);
    const a = await budget.acquire(signal());
    const b = await budget.acquire(signal());
    a.update(0.6);
    b.update(0.4);
    expect(a.signal.aborted).toBe(false);
    b.update(0.41);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(a.budgetError()).toBeInstanceOf(BudgetExceededError);
    await expect(budget.acquire(signal())).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('does not cut a stream for a reservation, which is not money spent', async () => {
    const { budget } = guard(1);
    const a = await budget.acquire(signal(), { estimate: { inputUsd: 0.5, outputAllowanceUsd: 0.2 } });
    const b = await budget.acquire(signal(), { estimate: { inputUsd: 0.1, outputAllowanceUsd: 0.1 } });
    a.update(0.3);
    expect(b.signal.aborted).toBe(false);
  });

  it('cuts the others when a finished call turns out to have passed the cap', async () => {
    const { budget, spent } = guard(1);
    const a = await budget.acquire(signal());
    const b = await budget.acquire(signal());
    spent.usd = 1.2;
    a.release();
    expect(b.signal.aborted).toBe(true);
  });
});

describe('estimating before the call', () => {
  it('charges a cached prefix at the read price and the new part at the write price', () => {
    expect(estimateInputUsd(OPUS, 1000, 0)).toBeCloseTo((1000 * 5) / 1e6);
    expect(estimateInputUsd(OPUS, 0, 100_000)).toBeCloseTo((100_000 * 0.2) / 1e6);
    expect(estimateInputUsd(OPUS, 0, 100_000)).toBeLessThan(estimateInputUsd(OPUS, 100_000, 0));
  });

  it('prices Haiku long context at the higher tier', () => {
    expect(estimateInputUsd('claude-haiku-5-5', 150_000, 0)).toBeCloseTo((150_000 * 0.625) / 1e6);
  });

  it('counts text, including Korean, and is conservative for English', () => {
    expect(estimateTokens({ text: 'a'.repeat(4000) })).toBeGreaterThanOrEqual(1000);
    expect(estimateTokens({ text: '가'.repeat(1000) })).toBeGreaterThanOrEqual(400);
  });

  it('does not let base64, signatures or encrypted results inflate the estimate', () => {
    const blob = 'A'.repeat(27_000_000);
    expect(estimateTokens({ source: { type: 'base64', data: blob } })).toBeLessThanOrEqual(50_100);
    expect(estimateTokens({ signature: blob, encrypted_content: blob, encrypted_index: blob })).toBeLessThan(10);
  });

  function loop(client: LlmClient, seen: CallEstimate[], onUsage = vi.fn(), messages: MessageParam[] = [{ role: 'user', content: '질문' }]) {
    return runAgentLoop({
      client,
      model: OPUS,
      effort: 'medium',
      maxTokens: 64_000,
      system: 's',
      tools: [],
      messages,
      signal: signal(),
      hooks: {
        beforeModelCall: (estimate) => {
          seen.push(estimate);
        },
        onUsage,
        onThinking: () => undefined,
        onText: () => undefined,
        onActivity: () => undefined,
        onServerToolStart: () => undefined,
        onServerToolFinish: () => undefined,
        runClientTools: async (blocks) => blocks.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'ok' })),
      },
    });
  }

  it('reserves a modest output share, far below max_tokens', async () => {
    const seen: CallEstimate[] = [];
    await loop(new FakeClient(() => ({ message: makeMessage([textBlock('답')]) })), seen);
    expect(seen[0].outputAllowanceUsd).toBeCloseTo(4000 * outputUsdPerToken(OPUS));
  });

  it('uses the real prompt size of the previous turn as the cached prefix', async () => {
    const seen: CallEstimate[] = [];
    const big = 'x'.repeat(250_000);
    const client = new FakeClient((_r, index) =>
      index === 0
        ? { message: makeMessage([toolUseBlock('t1', 'noop')], 'tool_use', { input_tokens: 100_000, output_tokens: 10 }) }
        : { message: makeMessage([textBlock('끝')]) }
    );
    await loop(client, seen, vi.fn(), [{ role: 'user', content: big }]);
    expect(seen).toHaveLength(2);
    // 두 번째 호출은 첫 호출을 캐시에서 읽으므로 입력 추정이 훨씬 싸다.
    expect(seen[1].inputUsd).toBeLessThan(seen[0].inputUsd / 5);
    expect(seen[1].inputUsd).toBeGreaterThan(0);
  });
});

describe('live usage', () => {
  /** 이벤트를 그대로 흘리는 클라이언트 */
  function scripted(events: unknown[], final = makeMessage([textBlock('답')])): LlmClient {
    return {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event as StreamEvent;
        },
        finalMessage: async () => final,
      }),
    };
  }

  function ticketRecorder() {
    const updates: number[] = [];
    return {
      updates,
      ticket: {
        signal: signal(),
        maxOutputUsd: 100,
        update: (usd: number) => updates.push(usd),
        budgetError: () => null,
        release: () => undefined,
      },
    };
  }

  const hooks = (ticket: ReturnType<typeof ticketRecorder>['ticket']) => ({
    beforeModelCall: () => ticket,
    onUsage: () => undefined,
    onThinking: () => undefined,
    onText: () => undefined,
    onActivity: () => undefined,
    onServerToolStart: () => undefined,
    onServerToolFinish: () => undefined,
    runClientTools: async () => [],
  });

  const base = {
    model: OPUS,
    effort: 'medium' as const,
    maxTokens: 64_000,
    system: 's',
    tools: [],
    messages: [{ role: 'user' as const, content: 'q' }],
    signal: signal(),
  };

  const start = { type: 'message_start', message: makeMessage([], null, { input_tokens: 1000, output_tokens: 1 }) };

  it('takes hidden thinking tokens from message_delta, which chars cannot show', async () => {
    const { ticket, updates } = ticketRecorder();
    await runAgentLoop({
      ...base,
      client: scripted([start, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50_000, input_tokens: null } }]),
      hooks: hooks(ticket),
    });
    expect(updates.at(-1)).toBeCloseTo((1000 * 4 + 50_000 * 20) / 1e6);
  });

  it('counts each web search as it starts, before the final usage reports it', async () => {
    const { ticket, updates } = ticketRecorder();
    const search = (index: number, id: string) => [
      { type: 'content_block_start', index, content_block: { type: 'server_tool_use', id, name: 'web_search', input: {} } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '{"query":"q"}' } },
      { type: 'content_block_stop', index },
    ];
    await runAgentLoop({
      ...base,
      client: scripted([start, ...search(0, 'a'), ...search(1, 'b')], makeMessage([serverToolBlock('a', 'web_search', { query: 'q' }), webSearchResultBlock('a'), textBlock('답')])),
      hooks: hooks(ticket),
    });
    const noSearch = costOf(OPUS, makeMessage([], null, { input_tokens: 1000, output_tokens: Math.ceil(26 / 2.5) }).usage).costUsd;
    expect(updates.at(-1)).toBeCloseTo(noSearch + 0.02, 3);
  });
});
