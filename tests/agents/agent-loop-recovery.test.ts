import Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { clientToolUses, CONTINUE_PROMPT, runAgentLoop, sanitizeForEcho, type AgentHooks, type AgentRunInput } from '@/lib/agents/agent-loop';
import { describeError, EmptyResponseError, isTransientStreamError, isUnparseableToolInput, TruncatedError, TurnLimitError } from '@/lib/agents/errors';
import type { ContentBlock, LlmRequest, ToolResultBlockParam, ToolUseBlock } from '@/lib/agents/llm';
import { FakeClient, makeMessage, serverToolBlock, textBlock, thinkingBlock, toolUseBlock, webSearchResultBlock, type ScriptedTurn } from './helpers';

beforeAll(() => {
  process.env.ILLIONAIRE_RETRY_DELAY_MS = '0';
});

function fallbackBlock(category: string | null = 'cyber'): ContentBlock {
  return {
    type: 'fallback',
    from: { model: 'claude-opus-5-5' },
    to: { model: 'claude-opus-5' },
    trigger: { type: 'refusal', category },
  } as unknown as ContentBlock;
}

function streamError(type: string, message = 'boom') {
  return new Anthropic.APIError(undefined, { type: 'error', error: { type, message } }, undefined, new Headers(), type as never);
}

function droppedConnection() {
  const err = new Anthropic.AnthropicError('terminated');
  (err as { cause?: unknown }).cause = new TypeError('terminated');
  return err;
}

function hooks(overrides: Partial<AgentHooks> = {}): AgentHooks {
  return {
    beforeModelCall: () => undefined,
    onUsage: () => undefined,
    onThinking: () => undefined,
    onText: () => undefined,
    onActivity: () => undefined,
    onServerToolStart: () => undefined,
    onServerToolFinish: () => undefined,
    runClientTools: async (blocks: ToolUseBlock[]) =>
      blocks.map((b): ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: b.id, content: 'ok' })),
    ...overrides,
  };
}

function input(client: FakeClient, h: AgentHooks, extra: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    client,
    model: 'claude-opus-5-5',
    effort: 'medium',
    maxTokens: 64000,
    system: 'system',
    tools: [],
    messages: [{ role: 'user', content: 'hello' }],
    signal: new AbortController().signal,
    hooks: h,
    ...extra,
  };
}

function scripted(turns: ScriptedTurn[]) {
  return new FakeClient((_req: LlmRequest, i: number) => turns[Math.min(i, turns.length - 1)]);
}

describe('empty final turn', () => {
  it('sends one new user turn instead of resending, then uses the answer', async () => {
    const client = scripted([
      { message: makeMessage([textBlock('확인할게요.'), toolUseBlock('t1', 'x')], 'tool_use') },
      { message: makeMessage([], 'end_turn') },
      { message: makeMessage([textBlock('오전 9시예요.')]) },
    ]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('오전 9시예요.');
    expect(client.requests).toHaveLength(3);
    const third = client.requests[2].messages;
    expect(third.at(-1)).toEqual({ role: 'user', content: CONTINUE_PROMPT });
    // 빈 assistant 턴은 API가 거부하므로 이력에 넣지 않는다.
    expect(third.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(third.slice(0, client.requests[1].messages.length)).toEqual(client.requests[1].messages);
  });

  it('falls back to the last non-empty text when the nudge is also empty', async () => {
    const client = scripted([
      { message: makeMessage([textBlock('지금은 오전 9시예요.'), toolUseBlock('t1', 'x')], 'tool_use') },
      { message: makeMessage([], 'end_turn') },
      { message: makeMessage([], 'end_turn') },
    ]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('지금은 오전 9시예요.');
    expect(client.requests).toHaveLength(3);
  });

  it('asks only once', async () => {
    const client = scripted([{ message: makeMessage([], 'end_turn') }]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('');
    expect(client.requests).toHaveLength(2);
  });

  it('does not put a thinking-only turn into history', async () => {
    const client = scripted([
      { message: makeMessage([thinkingBlock('생각만 함')], 'end_turn') },
      { message: makeMessage([textBlock('답')]) },
    ]);
    await runAgentLoop(input(client, hooks()));
    expect(client.requests[1].messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);
  });

  it('can be turned off, for structured output', async () => {
    const client = scripted([{ message: makeMessage([], 'end_turn') }]);
    await runAgentLoop(input(client, hooks(), { nudgeEmpty: false }));
    expect(client.requests).toHaveLength(1);
  });
});

describe('mid-stream fallback', () => {
  const mixed: ContentBlock[] = [
    thinkingBlock('거절된 모델의 추론'),
    { type: 'redacted_thinking', data: 'x' } as unknown as ContentBlock,
    { type: 'connector_text', connector_text: 'y' } as unknown as ContentBlock,
    textBlock('부분 답변'),
    textBlock('   '),
    toolUseBlock('declined', 'write_file', { path: 'a' }),
    serverToolBlock('srv_paired', 'web_search', { query: 'a' }),
    webSearchResultBlock('srv_paired'),
    serverToolBlock('srv_lonely', 'web_search', { query: 'b' }),
    fallbackBlock(),
    thinkingBlock('이어 받은 모델의 추론'),
    serverToolBlock('srv_after', 'web_search', { query: 'c' }),
    toolUseBlock('kept', 'list_files', { path: '~' }),
  ];

  it('follows the echo table', () => {
    const echo = sanitizeForEcho(mixed);
    expect(echo.map((b) => [b.type, (b as { id?: string }).id ?? (b as { tool_use_id?: string }).tool_use_id ?? ''])).toEqual([
      ['text', ''],
      ['server_tool_use', 'srv_paired'],
      ['web_search_tool_result', 'srv_paired'],
      ['fallback', ''],
      ['thinking', ''],
      ['server_tool_use', 'srv_after'],
      ['tool_use', 'kept'],
    ]);
  });

  it('keeps earlier fallback blocks in place and uses the final one as the boundary', () => {
    const echo = sanitizeForEcho([
      thinkingBlock('a'),
      textBlock('하나'),
      fallbackBlock(),
      thinkingBlock('b'),
      textBlock('둘'),
      fallbackBlock(),
      thinkingBlock('c'),
    ]);
    expect(echo.map((b) => b.type)).toEqual(['text', 'fallback', 'text', 'fallback', 'thinking']);
  });

  it('returns the same array when there is no fallback, so nothing is altered', () => {
    const content = [thinkingBlock('a'), textBlock('b')];
    expect(sanitizeForEcho(content)).toBe(content);
  });

  it('runs only the tool call made after the handoff', async () => {
    const runClientTools = vi.fn(async (blocks: ToolUseBlock[]) =>
      blocks.map((b): ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: b.id, content: 'ok' }))
    );
    const client = scripted([
      { message: makeMessage(mixed, 'tool_use') },
      { message: makeMessage([textBlock('끝')]) },
    ]);
    await runAgentLoop(input(client, hooks({ runClientTools })));
    expect(runClientTools).toHaveBeenCalledTimes(1);
    expect(runClientTools.mock.calls[0][0].map((b) => b.id)).toEqual(['kept']);
    expect(clientToolUses(mixed).map((b) => b.id)).toEqual(['kept']);

    const echoed = client.requests[1].messages[1].content as Array<{ type: string; id?: string }>;
    expect(echoed.some((b) => b.id === 'declined')).toBe(false);
    expect(echoed.filter((b) => b.type === 'thinking')).toHaveLength(1);
    const results = client.requests[1].messages[2].content as ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['kept']);
  });
});

describe('container and pause_turn', () => {
  it('sends the container id on later requests of the loop', async () => {
    const withContainer = { container: { id: 'container_abc', expires_at: '2030-01-01T00:00:00Z', skills: null } };
    const client = scripted([
      { message: makeMessage([serverToolBlock('s1', 'code_execution', {})], 'pause_turn', {}, withContainer as never) },
      { message: makeMessage([toolUseBlock('t1', 'x')], 'tool_use') },
      { message: makeMessage([textBlock('끝')]) },
    ]);
    await runAgentLoop(input(client, hooks()));
    expect(client.requests[0].container).toBeUndefined();
    expect(client.requests[1].container).toBe('container_abc');
    expect(client.requests[2].container).toBe('container_abc');
  });

  it('keeps text from before the pause in the result', async () => {
    const client = scripted([
      { message: makeMessage([textBlock('앞부분 '), serverToolBlock('s1', 'web_search', {})], 'pause_turn') },
      { message: makeMessage([webSearchResultBlock('s1'), textBlock('뒷부분')]) },
    ]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('앞부분 뒷부분');
  });

  it('does not carry text past a tool call', async () => {
    const client = scripted([
      { message: makeMessage([textBlock('중간 보고'), serverToolBlock('s1', 'web_search', {})], 'pause_turn') },
      { message: makeMessage([toolUseBlock('t1', 'x')], 'tool_use') },
      { message: makeMessage([textBlock('최종')]) },
    ]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('최종');
  });
});

describe('stream failures', () => {
  it('recognizes only the SDK tool JSON error as unparseable', () => {
    expect(isUnparseableToolInput(new Anthropic.AnthropicError('Unable to parse tool parameter JSON from model.'))).toBe(true);
    expect(isUnparseableToolInput(droppedConnection())).toBe(false);
    expect(isUnparseableToolInput(new Anthropic.AnthropicError('stream ended without producing a Message with role=assistant'))).toBe(false);
  });

  it('maps a dropped connection to network', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(describeError(droppedConnection()).code).toBe('network');
    spy.mockRestore();
  });

  it('retries a dropped connection a limited number of times, without concatenating partial text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text: string[] = [];
    const rollbacks: unknown[] = [];
    const client = new FakeClient((_r, i) => ({
      message: makeMessage([textBlock(`partial${i} `)]),
      errorAfterEvents: droppedConnection(),
    }));
    const err = await runAgentLoop(
      input(client, hooks({ onText: (d) => text.push(d), onRollback: (c) => rollbacks.push({ ...c }) }))
    ).catch((e) => e);

    expect(client.requests).toHaveLength(3);
    expect(describeError(err).code).toBe('network');
    // 다시 시도하기 전에 부분 본문을 지운다.
    expect(rollbacks).toEqual([
      { text: 9, thinking: 0 },
      { text: 9, thinking: 0 },
    ]);
    expect(text).toEqual(['partial0 ', 'partial1 ', 'partial2 ']);
    spy.mockRestore();
  });

  it('recovers when the retry succeeds, leaving only the clean text', async () => {
    let view = '';
    const client = new FakeClient((_r, i) =>
      i === 0
        ? { message: makeMessage([textBlock('잘린 부분')]), errorAfterEvents: droppedConnection() }
        : { message: makeMessage([textBlock('온전한 답')]) }
    );
    const result = await runAgentLoop(
      input(
        client,
        hooks({
          onText: (d) => {
            view += d;
          },
          onRollback: ({ text }) => {
            view = view.slice(0, view.length - text);
          },
        })
      )
    );
    expect(result.text).toBe('온전한 답');
    expect(view).toBe('온전한 답');
  });

  it('retries a mid-stream overload but not a mid-stream rate limit', async () => {
    const overload = new FakeClient((_r, i) =>
      i === 0 ? { error: streamError('overloaded_error') } : { message: makeMessage([textBlock('됐어요')]) }
    );
    expect((await runAgentLoop(input(overload, hooks()))).text).toBe('됐어요');
    expect(overload.requests).toHaveLength(2);

    const limited = new FakeClient(() => ({ error: streamError('rate_limit_error') }));
    await expect(runAgentLoop(input(limited, hooks()))).rejects.toMatchObject({ type: 'rate_limit_error' });
    expect(limited.requests).toHaveLength(1);
  });

  it('classifies which failures are transient', () => {
    expect(isTransientStreamError(streamError('overloaded_error'))).toBe(true);
    expect(isTransientStreamError(streamError('rate_limit_error'))).toBe(false);
    expect(isTransientStreamError(droppedConnection())).toBe(true);
    expect(isTransientStreamError(new Anthropic.AnthropicError('Unable to parse tool parameter JSON'))).toBe(false);
    // 응답 전 실패는 SDK가 이미 재시도했다.
    expect(isTransientStreamError(new Anthropic.APIConnectionError({ message: 'x' }))).toBe(false);
    expect(isTransientStreamError(new Anthropic.InternalServerError(529, {}, 'x', new Headers()))).toBe(false);
    expect(isTransientStreamError(new Anthropic.APIUserAbortError())).toBe(false);
  });

  it('counts usage from a call that fails after message_start', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const usage: { input: number; cost: number }[] = [];
    const client = new FakeClient(() => ({
      message: makeMessage([textBlock('부분')], 'end_turn', { input_tokens: 1000, output_tokens: 1 }),
      errorAfterEvents: streamError('rate_limit_error'),
    }));
    await runAgentLoop(
      input(client, hooks({ onUsage: (_m, d) => usage.push({ input: d.inputTokens, cost: d.costUsd }) }))
    ).catch(() => undefined);
    expect(usage).toHaveLength(1);
    expect(usage[0].input).toBe(1000);
    expect(usage[0].cost).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('counts nothing when a call fails before message_start', async () => {
    const onUsage = vi.fn();
    const client = new FakeClient(() => ({ error: streamError('rate_limit_error') }));
    await runAgentLoop(input(client, hooks({ onUsage }))).catch(() => undefined);
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe('error messages', () => {
  function apiError(status: number, type: string, message: string) {
    return Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());
  }

  it.each([
    [400, 'invalid_request_error', 'tools.0: bad schema'],
    [404, 'not_found_error', 'model: claude-x'],
    [413, 'request_too_large', 'too big'],
  ])('surfaces the status and API message for %i', (status, type, message) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const described = describeError(apiError(status, type, message));
    expect(described.code).toBe('internal');
    expect(described.message).toContain(String(status));
    expect(described.message).toContain(message);
    // 서버 콘솔에는 진단에 필요한 내용을 모두 남긴다.
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status, type, message }));
    log.mockRestore();
  });

  it('classifies by err.type, including errors that arrive mid-stream', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(describeError(streamError('rate_limit_error')).code).toBe('rate_limited');
    expect(describeError(streamError('overloaded_error')).code).toBe('overloaded');
    expect(describeError(streamError('authentication_error')).code).toBe('invalid_api_key');
    expect(describeError(streamError('billing_error')).code).toBe('invalid_api_key');
    expect(describeError(streamError('invalid_request_error', 'bad thing')).message).toContain('bad thing');
    log.mockRestore();
  });

  it('removes anything that looks like a key from the surfaced message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const described = describeError(apiError(400, 'invalid_request_error', 'bad key sk-ant-abc123-secret'));
    expect(described.message).not.toContain('abc123');
    log.mockRestore();
  });

  it('still hides unexpected internal errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(describeError(new Error('secret detail')).message).not.toContain('secret');
    expect(describeError(new EmptyResponseError()).message).toContain('빈 응답');
    log.mockRestore();
  });
});

describe('cut off and turn limit', () => {
  it('treats model_context_window_exceeded like max_tokens: no tools run', async () => {
    const runClientTools = vi.fn();
    const client = scripted([{ message: makeMessage([toolUseBlock('t1', 'write_file', { path: 'a' })], 'model_context_window_exceeded') }]);
    await expect(runAgentLoop(input(client, hooks({ runClientTools })))).rejects.toBeInstanceOf(TruncatedError);
    expect(runClientTools).not.toHaveBeenCalled();
    // 컨텍스트가 찼으면 같은 요청을 다시 보내도 소용없다.
    expect(client.requests).toHaveLength(1);
  });

  it('marks text cut off at the context window as truncated', async () => {
    const client = scripted([{ message: makeMessage([textBlock('잘린 답')], 'model_context_window_exceeded') }]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result).toMatchObject({ text: '잘린 답', truncated: true });
  });

  it('rolls back the text of a truncated attempt before retrying', async () => {
    const onRollback = vi.fn();
    const client = scripted([
      { message: makeMessage([textBlock('앞'), toolUseBlock('t1', 'x')], 'max_tokens') },
      { message: makeMessage([textBlock('다시')]) },
    ]);
    await runAgentLoop(input(client, hooks({ onRollback })));
    expect(onRollback).toHaveBeenCalledWith({ text: 1, thinking: 0 });
  });

  it('keeps the last text when the turn limit is hit', async () => {
    const client = scripted([{ message: makeMessage([textBlock('지금까지의 결과'), toolUseBlock('t1', 'x')], 'tool_use') }]);
    const err = await runAgentLoop(input(client, hooks(), { maxTurns: 2 })).catch((e) => e);
    expect(err).toBeInstanceOf(TurnLimitError);
    expect((err as TurnLimitError).partialText).toBe('지금까지의 결과');
  });
});
