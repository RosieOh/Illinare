import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop, type AgentHooks, type AgentRunInput } from '@/lib/agents/agent-loop';
import { RefusedError, TruncatedError, TurnLimitError } from '@/lib/agents/errors';
import type { LlmRequest, ToolResultBlockParam, ToolUseBlock } from '@/lib/agents/llm';
import { FakeClient, makeMessage, serverToolBlock, textBlock, thinkingBlock, toolUseBlock, webSearchResultBlock, type ScriptedTurn } from './helpers';

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

describe('runAgentLoop', () => {
  it('returns the last message text on end_turn', async () => {
    const client = scripted([{ message: makeMessage([thinkingBlock('음'), textBlock('끝')]) }]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result).toMatchObject({ text: '끝', truncated: false });
  });

  it('resends a paused turn without any extra user text', async () => {
    const paused = makeMessage([serverToolBlock('srv1', 'web_search', { query: 'x' })], 'pause_turn');
    const client = scripted([{ message: paused }, { message: makeMessage([textBlock('완료')]) }]);
    await runAgentLoop(input(client, hooks()));

    expect(client.requests).toHaveLength(2);
    const second = client.requests[1].messages;
    expect(second).toHaveLength(2);
    expect(second[1].role).toBe('assistant');
    expect(second.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('runs no tools when the model refuses', async () => {
    const runClientTools = vi.fn();
    const refused = makeMessage([toolUseBlock('t1', 'danger_tool')], 'refusal', {}, {
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    } as never);
    const client = scripted([{ message: refused }]);
    await expect(runAgentLoop(input(client, hooks({ runClientTools })))).rejects.toBeInstanceOf(RefusedError);
    expect(runClientTools).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(1);
  });

  it('runs no tools when the input was cut off at max_tokens', async () => {
    const runClientTools = vi.fn();
    const truncated = makeMessage([toolUseBlock('t1', 'write_file', { path: 'a' })], 'max_tokens');
    const client = scripted([{ message: truncated }, { message: truncated }]);
    await expect(runAgentLoop(input(client, hooks({ runClientTools })))).rejects.toBeInstanceOf(TruncatedError);
    expect(runClientTools).not.toHaveBeenCalled();
    // 잘린 턴은 이력에 넣지 않고 같은 요청을 한 번 더 보낸다.
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].messages).toEqual(client.requests[0].messages);
  });

  it('recovers when the retry after truncation succeeds', async () => {
    const client = scripted([
      { message: makeMessage([toolUseBlock('t1', 'write_file', { path: 'a' })], 'max_tokens') },
      { message: makeMessage([textBlock('짧게 끝냈어요')]) },
    ]);
    const result = await runAgentLoop(input(client, hooks()));
    expect(result.text).toBe('짧게 끝냈어요');
  });

  it('keeps history append-only across turns and passes assistant content verbatim', async () => {
    const thinkingTurn = makeMessage([thinkingBlock('계획'), toolUseBlock('t1', 'a'), toolUseBlock('t2', 'b')], 'tool_use');
    const secondTurn = makeMessage([toolUseBlock('t3', 'c')], 'tool_use');
    const client = scripted([{ message: thinkingTurn }, { message: secondTurn }, { message: makeMessage([textBlock('끝')]) }]);
    await runAgentLoop(input(client, hooks()));

    const [r0, r1, r2] = client.requests;
    expect(r1.messages.slice(0, r0.messages.length)).toEqual(r0.messages);
    expect(r2.messages.slice(0, r1.messages.length)).toEqual(r1.messages);
    expect(r1.messages[1]).toEqual({ role: 'assistant', content: JSON.parse(JSON.stringify(thinkingTurn.content)) });
  });

  it('returns all tool results of a turn in one user message', async () => {
    const client = scripted([
      { message: makeMessage([toolUseBlock('t1', 'a'), toolUseBlock('t2', 'b')], 'tool_use') },
      { message: makeMessage([textBlock('끝')]) },
    ]);
    await runAgentLoop(input(client, hooks()));
    const last = client.requests[1].messages.at(-1);
    expect(last?.role).toBe('user');
    expect((last?.content as ToolResultBlockParam[]).map((b) => b.tool_use_id)).toEqual(['t1', 't2']);
  });

  it('retries only the SDK JSON error, capped at two retries', async () => {
    const jsonError = new Anthropic.AnthropicError('Unable to parse tool parameter JSON from model.');
    const client = scripted([{ error: jsonError }]);
    await expect(runAgentLoop(input(client, hooks()))).rejects.toBe(jsonError);
    expect(client.requests).toHaveLength(3);
  });

  it('does not retry typed API errors', async () => {
    const apiError = new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers());
    const client = scripted([{ error: apiError }]);
    await expect(runAgentLoop(input(client, hooks()))).rejects.toBe(apiError);
    expect(client.requests).toHaveLength(1);
  });

  it('checks the budget hook before every model call', async () => {
    const beforeModelCall = vi.fn();
    const client = scripted([
      { message: makeMessage([toolUseBlock('t1', 'a')], 'tool_use') },
      { message: makeMessage([textBlock('끝')]) },
    ]);
    await runAgentLoop(input(client, hooks({ beforeModelCall })));
    expect(beforeModelCall).toHaveBeenCalledTimes(2);
  });

  it('stops after the turn limit', async () => {
    const client = scripted([{ message: makeMessage([toolUseBlock('t1', 'a')], 'tool_use') }]);
    await expect(runAgentLoop(input(client, hooks(), { maxTurns: 3 }))).rejects.toBeInstanceOf(TurnLimitError);
    expect(client.requests).toHaveLength(3);
  });

  it('reports server tools with their parsed input and result', async () => {
    const started: unknown[] = [];
    const finished: unknown[] = [];
    const client = scripted([
      {
        message: makeMessage([
          serverToolBlock('srv1', 'web_search', { query: '가격' }),
          webSearchResultBlock('srv1'),
          textBlock('찾았어요'),
        ]),
      },
    ]);
    await runAgentLoop(
      input(
        client,
        hooks({
          onServerToolStart: (c) => started.push(c),
          onServerToolFinish: (id, ok, text) => finished.push({ id, ok, text }),
        })
      )
    );
    expect(started).toEqual([{ id: 'srv1', name: 'web_search', input: { query: '가격' } }]);
    expect(finished).toEqual([{ id: 'srv1', ok: true, text: '예시 — https://example.com' }]);
  });

  it('streams thinking and text through the hooks', async () => {
    const thinking: string[] = [];
    const text: string[] = [];
    const client = scripted([{ message: makeMessage([thinkingBlock('생각'), textBlock('답변')]) }]);
    await runAgentLoop(input(client, hooks({ onThinking: (d) => thinking.push(d), onText: (d) => text.push(d) })));
    expect(thinking.join('')).toBe('생각');
    expect(text.join('')).toBe('답변');
  });
});
