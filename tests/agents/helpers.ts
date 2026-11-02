import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmRequest, LlmStream, Message, StreamEvent } from '@/lib/agents/llm';

export interface ScriptedTurn {
  message?: Message;
  /** 스트림 도중 던질 오류 */
  error?: unknown;
  /** 이 약속이 풀릴 때까지 스트림을 멈춘다 */
  wait?: Promise<unknown>;
  /** message의 이벤트를 모두 보낸 뒤 finalMessage 없이 던질 오류 (스트림 도중 실패) */
  errorAfterEvents?: unknown;
}

type Block = Message['content'][number];

export function textBlock(text: string): Block {
  return { type: 'text', text, citations: null } as unknown as Block;
}

export function thinkingBlock(thinking: string): Block {
  return { type: 'thinking', thinking, signature: `sig-${thinking.length}` } as unknown as Block;
}

export function toolUseBlock(id: string, name: string, input: unknown = {}): Block {
  return { type: 'tool_use', id, name, input } as unknown as Block;
}

export function serverToolBlock(id: string, name: string, input: unknown): Block {
  return { type: 'server_tool_use', id, name, input } as unknown as Block;
}

export function webSearchResultBlock(toolUseId: string): Block {
  return {
    type: 'web_search_tool_result',
    tool_use_id: toolUseId,
    content: [{ type: 'web_search_result', title: '예시', url: 'https://example.com', encrypted_content: 'x', page_age: null }],
  } as unknown as Block;
}

export function makeMessage(
  content: Block[],
  stopReason: Message['stop_reason'] = 'end_turn',
  usage: Partial<Message['usage']> = {},
  extra: Partial<Message> = {}
): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      iterations: null,
      ...usage,
    },
    ...extra,
  } as unknown as Message;
}

function eventsFor(message: Message): StreamEvent[] {
  // 실제 message_start처럼 입력 토큰은 정확하고 출력 토큰은 아직 거의 없다.
  const events: unknown[] = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 1 } } },
  ];
  message.content.forEach((block, index) => {
    const b = block as unknown as Record<string, unknown>;
    if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { ...b, text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else if (b.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { ...b, thinking: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
    } else if (b.type === 'server_tool_use') {
      events.push({ type: 'content_block_start', index, content_block: { ...b, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: b });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_stop' });
  return events as StreamEvent[];
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Anthropic.APIUserAbortError());
      return;
    }
    const onAbort = () => reject(new Anthropic.APIUserAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** 스크립트대로 응답하는 가짜 클라이언트. 요청은 호출 시점의 사본으로 기록한다. */
export class FakeClient implements LlmClient {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: (request: LlmRequest, index: number) => ScriptedTurn | Promise<ScriptedTurn>) {}

  stream(request: LlmRequest, signal: AbortSignal): LlmStream {
    const index = this.requests.length;
    this.requests.push(JSON.parse(JSON.stringify(request)) as LlmRequest);
    let final: Message | undefined;
    const script = this.script;

    return {
      async *[Symbol.asyncIterator]() {
        const turn = await abortable(Promise.resolve(script(request, index)), signal);
        if (turn.wait) await abortable(turn.wait, signal);
        if (turn.error) throw turn.error;
        const message = turn.message as Message;
        for (const event of eventsFor(message)) {
          if (signal.aborted) throw new Anthropic.APIUserAbortError();
          yield event;
        }
        if (turn.errorAfterEvents) throw turn.errorAfterEvents;
        final = message;
      },
      async finalMessage() {
        if (!final) throw new Error('스트림을 다 읽기 전에 finalMessage를 호출했어요');
        return final;
      },
    };
  }
}

export async function waitUntil(check: () => boolean | Promise<boolean>, what = '조건', timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`${what}을(를) 기다리다 시간 초과`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 첫 사용자 메시지의 <your_task> 내용 */
export function taskOf(request: LlmRequest): string {
  const first = request.messages[0]?.content;
  const text = typeof first === 'string' ? first : '';
  return /<your_task>\n([\s\S]*?)\n<\/your_task>/.exec(text)?.[1] ?? '';
}
