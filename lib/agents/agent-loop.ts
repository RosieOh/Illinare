import type Anthropic from '@anthropic-ai/sdk';
import type { UsageTotals } from '@/lib/contracts';
import type { CallEstimate, CallTicket } from './budget';
import { CancelledError, isCancellation, isTransientStreamError, isUnparseableToolInput, RefusedError, TruncatedError, TurnLimitError } from './errors';
import { textOf, type ContentBlock, type Effort, type LlmClient, type Message, type MessageParam, type StreamEvent, type ToolResultBlockParam, type ToolUnion, type ToolUseBlock } from './llm';
import { costOf, costOfMessage, estimateInputUsd, outputUsdPerToken } from './pricing';

const MAX_TURNS = 16;
const MAX_JSON_RETRIES = 2;
const MAX_TRANSIENT_RETRIES = 2;
const COALESCE_MS = 40;
/** 스트림 중 비용 추정. 한글이 섞이면 토큰당 글자 수가 영어보다 적어 보수적으로 잡는다. */
const CHARS_PER_TOKEN = 2.5;
const METER_STEP_CHARS = 800;

/** 빈 응답은 그대로 다시 보내도 빈 응답이다. 문서대로 새 사용자 메시지를 보낸다. */
export const CONTINUE_PROMPT = 'Please continue with your final answer.';

/** 예산이 거의 없어도 답을 낼 수 있는 최소한의 출력 */
const MIN_BUDGETED_TOKENS = 4_000;

/** 추론은 끝날 때까지 토큰 수가 보이지 않으므로 max_tokens로 호출당 출력 비용을 묶어 둔다. */
function budgetedMaxTokens(maxTokens: number, model: string, ticket: CallTicket | undefined): number {
  if (!ticket) return maxTokens;
  const affordable = Math.floor(ticket.maxOutputUsd / outputUsdPerToken(model));
  return Math.min(maxTokens, Math.max(MIN_BUDGETED_TOKENS, affordable));
}

/** 토큰 수에 들어가지 않거나 크기가 토큰과 무관한 값. 암호화된 값이나 서명을 글자 수로 세면 예약이 크게 부풀어 호출을 막는다. */
const OPAQUE_FIELDS = new Set(['signature', 'encrypted_content', 'encrypted_index']);
/** base64 첨부는 글자 수가 아니라 대략 바이트 크기로 잰다. 20MB PDF 하나가 상한을 막으면 안 된다. */
const ATTACHMENT_BYTES_PER_TOKEN = 64;
const ATTACHMENT_MAX_TOKENS = 50_000;

/** 요청을 보내기 전의 입력 토큰 추정. 정확할 필요는 없고 message_start가 실제 값을 알려줄 때까지만 쓴다. */
export function estimateTokens(value: unknown): number {
  let attachmentTokens = 0;
  const json = JSON.stringify(value, (key, v: unknown) => {
    if (OPAQUE_FIELDS.has(key)) return undefined;
    if (key === 'data' && typeof v === 'string') {
      attachmentTokens += Math.min(ATTACHMENT_MAX_TOKENS, Math.ceil((v.length * 0.75) / ATTACHMENT_BYTES_PER_TOKEN));
      return undefined;
    }
    return v;
  });
  return Math.ceil((json?.length ?? 0) / CHARS_PER_TOKEN) + attachmentTokens;
}

function promptTokens(usage: Anthropic.Beta.BetaUsage): number {
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

function retryDelayMs(): number {
  const value = Number(process.env.ILLIONAIRE_RETRY_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : 1000;
}

export interface ServerToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentHooks {
  /** 모델 호출 직전. 예산을 넘었으면 throw 한다. 티켓을 돌려주면 호출이 끝날 때 반납한다. */
  beforeModelCall: (estimate: CallEstimate) => void | CallTicket | Promise<void | CallTicket>;
  onUsage: (model: string, delta: UsageTotals) => void;
  onThinking: (delta: string) => void;
  onText: (delta: string) => void;
  /** 다시 시도하거나 거절된 호출이 이미 내보낸 스트림을 지운다. */
  onRollback?: (chars: { text: number; thinking: number }) => void;
  onActivity: (activity: string) => void;
  onServerToolStart: (call: ServerToolCall) => void;
  onServerToolFinish: (id: string, ok: boolean, result: string) => void;
  /** 한 턴의 클라이언트 도구를 실행하고 같은 순서로 tool_result를 돌려준다. */
  runClientTools: (blocks: ToolUseBlock[]) => Promise<ToolResultBlockParam[]>;
}

export interface AgentRunInput {
  client: LlmClient;
  model: string;
  effort: Effort;
  maxTokens: number;
  system: string;
  tools: ToolUnion[];
  messages: MessageParam[];
  signal: AbortSignal;
  hooks: AgentHooks;
  maxTurns?: number;
  /** structured outputs 스키마 */
  format?: Record<string, unknown>;
  /** 빈 end_turn에 이어서 답하라고 다시 묻는다. 기본 true. */
  nudgeEmpty?: boolean;
}

export interface AgentRunResult {
  /** 마지막 메시지의 본문. 비었으면 그 전에 받은 마지막 본문. */
  text: string;
  /** 본문이 길이 제한에서 잘렸는가 */
  truncated: boolean;
  /** 마지막 assistant 턴을 다시 보낼 때 쓸 내용 */
  content: ContentBlock[];
}

/** 잦은 델타를 묶어서 이벤트 수를 줄인다. 도구 이벤트 전에는 반드시 비운다. */
export class DeltaCoalescer {
  private thinking = '';
  private text = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly hooks: Pick<AgentHooks, 'onThinking' | 'onText'>) {}

  pushThinking(delta: string) {
    this.thinking += delta;
    this.schedule();
  }

  pushText(delta: string) {
    this.text += delta;
    this.schedule();
  }

  private schedule() {
    this.timer ??= setTimeout(() => this.flush(), COALESCE_MS);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.thinking) {
      const delta = this.thinking;
      this.thinking = '';
      this.hooks.onThinking(delta);
    }
    if (this.text) {
      const delta = this.text;
      this.text = '';
      this.hooks.onText(delta);
    }
  }
}

function serverToolActivity(name: string): string {
  switch (name) {
    case 'web_search':
      return '웹 검색 중';
    case 'web_fetch':
      return '웹 페이지 읽는 중';
    case 'code_execution':
    case 'bash_code_execution':
    case 'text_editor_code_execution':
      return '코드 실행 중';
    default:
      return '도구 실행 중';
  }
}

type ServerResultBlock = Extract<ContentBlock, { tool_use_id: string }>;

function isServerResult(block: ContentBlock): block is ServerResultBlock {
  return block.type.endsWith('_tool_result') && 'tool_use_id' in block;
}

/** 서버 도구 결과 블록을 화면용 짧은 문자열로 바꾼다. */
export function describeServerResult(block: ServerResultBlock): { ok: boolean; text: string } {
  const content = (block as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const lines = content
      .filter((r): r is Anthropic.Beta.BetaWebSearchResultBlock => (r as { type?: string }).type === 'web_search_result')
      .map((r) => `${r.title} — ${r.url}`);
    return { ok: true, text: lines.join('\n') || `결과 ${content.length}건` };
  }
  if (content && typeof content === 'object') {
    const c = content as { type?: string; error_code?: string; url?: string; stdout?: string; stderr?: string; return_code?: number };
    if (c.error_code || c.type?.endsWith('_error')) return { ok: false, text: `오류: ${c.error_code ?? c.type}` };
    if (c.url) return { ok: true, text: c.url };
    if (typeof c.stdout === 'string' || typeof c.stderr === 'string') {
      const text = [c.stdout, c.stderr].filter(Boolean).join('\n').slice(0, 2000);
      return { ok: (c.return_code ?? 0) === 0, text: text || '출력 없음' };
    }
  }
  return { ok: true, text: '완료' };
}

function lastFallbackIndex(content: ContentBlock[]): number {
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'fallback') return i;
  }
  return -1;
}

/**
 * 스트리밍 중 다른 모델로 넘어간 턴을 다시 보낼 내용으로 정리한다 (refusals-and-fallback, Continuing the conversation).
 * 마지막 fallback 블록 앞에서는 text, fallback, 결과와 짝이 맞는 서버 도구만 남기고
 * thinking, redacted_thinking, 클라이언트 tool_use 등은 버린다. 뒤쪽은 그대로 둔다.
 * fallback 블록이 없으면 받은 배열을 그대로 돌려준다 (thinking 블록이 변형되면 안 된다).
 */
export function sanitizeForEcho(content: ContentBlock[]): ContentBlock[] {
  const boundary = lastFallbackIndex(content);
  if (boundary < 0) return content;
  const resultIds = new Set(content.filter(isServerResult).map((b) => b.tool_use_id));
  const useIds = new Set(
    content.flatMap((b) => (b.type === 'server_tool_use' ? [b.id] : []))
  );
  return content.filter((block, index) => {
    if (index >= boundary) return true;
    if (block.type === 'fallback') return true;
    // 시작만 되고 끊긴 빈 text 블록은 API가 받지 않는다.
    if (block.type === 'text') return block.text.trim() !== '';
    if (block.type === 'server_tool_use') return resultIds.has(block.id);
    if (isServerResult(block)) return useIds.has(block.tool_use_id);
    return false;
  });
}

/** 실행할 도구는 마지막 fallback 뒤에서만 고른다. 앞쪽은 거절된 모델이 쓰다 만 호출이다. */
export function clientToolUses(content: ContentBlock[]): ToolUseBlock[] {
  return content.slice(lastFallbackIndex(content) + 1).filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

function hasEchoableContent(content: ContentBlock[]): boolean {
  return content.some((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
}

/** 스트림 중 비용을 추정한다. finalMessage를 받지 못한 호출의 사용량도 여기서 나온다. */
class CallMeter {
  private model: string | null = null;
  private usage: Anthropic.Beta.BetaUsage | null = null;
  private chars = 0;
  private reportedChars = 0;
  private searches = 0;

  constructor(private readonly ticket: CallTicket | undefined) {}

  start(message: Message) {
    this.model = message.model;
    this.usage = message.usage;
    this.report();
  }

  add(chars: number) {
    this.chars += chars;
    if (this.chars - this.reportedChars >= METER_STEP_CHARS) this.report();
  }

  /** message_delta의 누적 사용량. 값이 없는 필드는 앞선 값을 지키고, 보이지 않던 추론 토큰도 여기서 드러난다. */
  applyDelta(delta: Partial<Record<keyof Anthropic.Beta.BetaMessageDeltaUsage, unknown>>) {
    if (!this.usage) return;
    const known = Object.fromEntries(Object.entries(delta).filter(([, value]) => value !== null && value !== undefined));
    this.usage = { ...this.usage, ...known };
    this.report();
  }

  /** 검색은 건당 요금이 붙는데 호출이 끝나야 집계되므로 시작할 때 세어 둔다. */
  addSearch() {
    this.searches++;
    this.report();
  }

  private report() {
    this.reportedChars = this.chars;
    const estimate = this.estimate();
    if (estimate) this.ticket?.update(estimate.delta.costUsd);
  }

  /** message_start를 받기 전이면 null. 그 전에 실패한 호출은 청구되지 않는다. */
  estimate(): { model: string; delta: UsageTotals } | null {
    if (!this.model || !this.usage) return null;
    const outputTokens = Math.max(this.usage.output_tokens, Math.ceil(this.chars / CHARS_PER_TOKEN));
    const serverUse = this.usage.server_tool_use;
    const searches = Math.max(serverUse?.web_search_requests ?? 0, this.searches);
    return {
      model: this.model,
      delta: costOf(this.model, {
        ...this.usage,
        output_tokens: outputTokens,
        server_tool_use: searches > 0 ? { web_fetch_requests: serverUse?.web_fetch_requests ?? 0, web_search_requests: searches } : serverUse,
      }),
    };
  }
}

interface AttemptState {
  coalescer: DeltaCoalescer;
  meter: CallMeter;
  pendingServer: Map<number, { id: string; name: string; json: string }>;
  /** 턴을 넘어 열려 있는 서버 도구 (pause_turn 후 결과가 다음 턴에 올 수 있다) */
  openServer: Set<string>;
  /** 이번 시도에서 시작한 서버 도구 */
  startedServer: Set<string>;
  hooks: AgentHooks;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 스트리밍 수동 루프: stream → finalMessage → stop_reason 분기.
 * 이력은 추가만 한다. assistant 턴은 받은 그대로 다시 보낸다 (thinking 블록이 변형되면 안 된다).
 */
export async function runAgentLoop(input: AgentRunInput): Promise<AgentRunResult> {
  const { client, hooks, signal } = input;
  const maxTurns = input.maxTurns ?? MAX_TURNS;
  let messages = input.messages;
  let containerId: string | undefined;
  let jsonRetries = 0;
  let transientRetries = 0;
  let truncationRetried = false;
  let nudged = false;
  /** pause_turn 사이에 나뉘어 온 본문 */
  let carriedText = '';
  /** 마지막으로 비어 있지 않았던 본문. 빈 응답이나 턴 한도일 때 결과로 쓴다. */
  let lastText = '';
  const openServer = new Set<string>();
  /** 앞선 호출의 실제 입력 토큰. 다음 호출에서 이만큼은 캐시에서 읽힌다. */
  let lastPrompt: { tokens: number; estimated: number } | null = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) throw new CancelledError();
    const estimated = estimateTokens({ system: input.system, tools: input.tools, format: input.format, messages });
    const freshTokens = Math.max(0, estimated - (lastPrompt?.estimated ?? 0));
    const ticket =
      (await hooks.beforeModelCall({
        inputUsd: estimateInputUsd(input.model, freshTokens, lastPrompt?.tokens ?? 0),
        // 호출당 최소 출력(max_tokens 하한)만 예약한다. 나머지는 max_tokens와 실시간 사용량이 묶는다.
        outputAllowanceUsd: MIN_BUDGETED_TOKENS * outputUsdPerToken(input.model),
      })) ?? undefined;

    const emitted = { text: 0, thinking: 0 };
    const coalescer = new DeltaCoalescer({
      onThinking: (delta) => {
        emitted.thinking += delta.length;
        hooks.onThinking(delta);
      },
      onText: (delta) => {
        emitted.text += delta.length;
        hooks.onText(delta);
      },
    });
    const state: AttemptState = {
      coalescer,
      meter: new CallMeter(ticket),
      pendingServer: new Map(),
      openServer,
      startedServer: new Set(),
      hooks,
    };
    /** 이번 시도가 내보낸 것을 지운다. 다음 시도의 본문과 이어 붙지 않게 한다. */
    const rollback = () => {
      coalescer.flush();
      if (emitted.text > 0 || emitted.thinking > 0) hooks.onRollback?.(emitted);
      for (const id of state.startedServer) {
        if (openServer.delete(id)) hooks.onServerToolFinish(id, false, '호출을 다시 시도해 취소됐어요.');
      }
    };

    let message: Message | null = null;
    let retryAfter: number | null = null;
    try {
      try {
        const stream = client.stream(
          {
            model: input.model,
            maxTokens: budgetedMaxTokens(input.maxTokens, input.model, ticket),
            effort: input.effort,
            system: input.system,
            tools: input.tools,
            messages,
            format: input.format,
            container: containerId,
          },
          ticket?.signal ?? signal
        );
        // SDK는 content_block_stop에서 입력을 파싱하므로 순회와 finalMessage를 함께 감싼다.
        for await (const event of stream as AsyncIterable<StreamEvent>) {
          handleEvent(event, state);
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
        transientRetries = 0;
      } catch (err) {
        coalescer.flush();
        // finalMessage를 받지 못해도 생성된 만큼은 청구되므로 추정치라도 기록한다.
        const partial = state.meter.estimate();
        if (partial) hooks.onUsage(partial.model, partial.delta);

        const overBudget = ticket?.budgetError();
        if (overBudget && !signal.aborted && isCancellation(err)) throw overBudget;

        if (isUnparseableToolInput(err) && jsonRetries < MAX_JSON_RETRIES) {
          jsonRetries++;
          rollback();
          retryAfter = 0;
        } else if (!signal.aborted && isTransientStreamError(err) && transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          rollback();
          retryAfter = retryDelayMs() * transientRetries;
        } else {
          throw err;
        }
      }
      if (message) {
        coalescer.flush();
        hooks.onUsage(message.model, costOfMessage(message));
      }
    } finally {
      ticket?.release();
    }

    if (retryAfter !== null) {
      if (retryAfter > 0) await abortableDelay(retryAfter, signal);
      continue;
    }
    if (!message) throw new TurnLimitError(lastText);

    lastPrompt = { tokens: promptTokens(message.usage), estimated };
    containerId = message.container?.id ?? containerId;
    if (message.input_transformations?.length) {
      console.warn('[mission] API가 thinking 블록을 처리에서 뺐어요', message.input_transformations);
    }

    // 거절된 턴은 tool_use가 입력 중간에 잘렸을 수 있으므로 어떤 도구도 실행하지 않는다.
    // 부분 출력은 문서대로 버린다.
    if (message.stop_reason === 'refusal') {
      rollback();
      throw new RefusedError(message.stop_details?.category ?? null);
    }

    const echo = sanitizeForEcho(message.content);
    const messageText = textOf({ content: echo });
    const accumulated = carriedText + messageText;
    if (accumulated.trim()) lastText = accumulated;

    if (message.stop_reason === 'pause_turn') {
      // 서버 도구 반복 한도. 추가 사용자 메시지 없이 그대로 다시 보내면 이어서 진행한다.
      carriedText = accumulated;
      messages = [...messages, { role: 'assistant', content: echo }];
      continue;
    }

    const toolUses = clientToolUses(message.content);
    const cutOff = message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded';

    if (toolUses.length === 0) {
      if (accumulated.trim() || nudged || input.nudgeEmpty === false || message.stop_reason !== 'end_turn') {
        for (const id of openServer) hooks.onServerToolFinish(id, true, '완료');
        openServer.clear();
        return { text: accumulated.trim() ? accumulated : lastText, truncated: cutOff, content: echo };
      }
      nudged = true;
      // 추론만 담긴 빈 턴은 이력에 넣지 않는다. 아직 보낸 적 없으므로 수정이 아니다.
      messages = [
        ...messages,
        ...(hasEchoableContent(echo) ? [{ role: 'assistant' as const, content: echo }] : []),
        { role: 'user', content: CONTINUE_PROMPT },
      ];
      continue;
    }

    // 잘린 입력은 스키마 검증을 통과할 수 있으므로 실행하지 않는다. 이력에 넣지 않는다.
    if (cutOff) {
      rollback();
      // 컨텍스트 한도는 같은 요청을 다시 보내도 넘는다. max_tokens만 한 번 더 시도한다.
      if (message.stop_reason === 'max_tokens' && !truncationRetried) {
        truncationRetried = true;
        continue;
      }
      throw new TruncatedError(lastText);
    }

    messages = [...messages, { role: 'assistant', content: echo }];
    const results = await hooks.runClientTools(toolUses);
    // 병렬 호출 결과는 하나의 user 메시지로 돌려준다.
    messages = [...messages, { role: 'user', content: results }];
    carriedText = '';
  }

  throw new TurnLimitError(lastText);
}

function handleEvent(event: StreamEvent, state: AttemptState) {
  const { coalescer, meter, pendingServer, openServer, startedServer, hooks } = state;
  switch (event.type) {
    case 'message_start':
      meter.start(event.message);
      break;
    case 'message_delta':
      meter.applyDelta(event.usage);
      break;
    case 'content_block_start': {
      const block = event.content_block;
      if (block.type === 'server_tool_use') {
        coalescer.flush();
        pendingServer.set(event.index, { id: block.id, name: block.name, json: '' });
        hooks.onActivity(serverToolActivity(block.name));
      } else if (isServerResult(block)) {
        coalescer.flush();
        const { ok, text } = describeServerResult(block);
        openServer.delete(block.tool_use_id);
        hooks.onServerToolFinish(block.tool_use_id, ok, text);
      }
      break;
    }
    case 'content_block_delta': {
      const { delta } = event;
      if (delta.type === 'text_delta') {
        coalescer.pushText(delta.text);
        meter.add(delta.text.length);
      } else if (delta.type === 'thinking_delta') {
        coalescer.pushThinking(delta.thinking);
        meter.add(delta.thinking.length);
      } else if (delta.type === 'input_json_delta') {
        meter.add(delta.partial_json.length);
        const entry = pendingServer.get(event.index);
        if (entry) entry.json += delta.partial_json;
      }
      break;
    }
    case 'content_block_stop': {
      const entry = pendingServer.get(event.index);
      if (entry) {
        pendingServer.delete(event.index);
        let parsed: unknown = {};
        try {
          parsed = entry.json ? JSON.parse(entry.json) : {};
        } catch {
          parsed = {};
        }
        openServer.add(entry.id);
        startedServer.add(entry.id);
        if (entry.name === 'web_search') meter.addSearch();
        hooks.onServerToolStart({ id: entry.id, name: entry.name, input: parsed });
      }
      break;
    }
    default:
      break;
  }
}
