import Anthropic from '@anthropic-ai/sdk';

export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type Message = Anthropic.Beta.BetaMessage;
export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type ToolUnion = Anthropic.Beta.BetaToolUnion;
export type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type ToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmRequest {
  model: string;
  maxTokens: number;
  effort: Effort;
  /** 고정 문자열이어야 한다. 프롬프트 캐시가 깨지지 않도록 시간 같은 값을 넣지 않는다. */
  system: string;
  messages: MessageParam[];
  tools?: ToolUnion[];
  /** 지정하면 structured outputs로 이 JSON 스키마에 맞춰 응답한다. */
  format?: Record<string, unknown>;
  /** 이전 응답의 컨테이너. 코드 실행이 이어지려면 같은 루프의 다음 요청에 함께 보내야 한다. */
  container?: string;
}

export interface LlmStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<Message>;
}

export interface LlmClient {
  stream(request: LlmRequest, signal: AbortSignal): LlmStream;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

/** Haiku에는 server-side fallback이 없으므로 베타 헤더도 보내지 않는다. */
function supportsFallback(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

/**
 * 모든 모델 호출의 요청 본문. temperature/top_p/top_k와 강제 tool_choice는
 * 이 모델들에서 400이므로 보내지 않는다.
 *
 * prefix_mismatch_behavior: 'drop_block': 2026-08-31 이후 만든 계정은 이력이 조금이라도 달라지면
 * thinking 블록 때문에 요청 전체가 400이 된다. 이력은 추가만 하지만, eager 스트리밍에서 SDK의 관대한
 * 파서가 잘못된 도구 입력을 잘라 돌려주면 다시 보내는 tool_use가 원본과 달라질 수 있다. 이 앱은
 * 지켜보는 개발자 없이 사용자 기기에서 돌아가므로 진행 중인 미션을 죽이는 대신 추론만 잃는 쪽을 고른다.
 * 빠진 블록은 응답의 input_transformations로 보고되고 서버 콘솔에 남긴다.
 */
export function buildRequestParams(req: LlmRequest): Parameters<Anthropic['beta']['messages']['stream']>[0] {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    thinking: {
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    },
    output_config: {
      effort: req.effort,
      ...(req.format ? { format: { type: 'json_schema' as const, schema: req.format } } : {}),
    },
    cache_control: { type: 'ephemeral' },
    ...(req.tools?.length ? { tools: req.tools } : {}),
    ...(req.container ? { container: req.container } : {}),
    ...(supportsFallback(req.model)
      ? { betas: [FALLBACK_BETA, THINKING_BINDING_BETA], fallbacks: 'default' as const }
      : { betas: [THINKING_BINDING_BETA] }),
  };
}

function sdkClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, maxRetries: 4 });
  return {
    stream(request, signal) {
      return client.beta.messages.stream(buildRequestParams(request), { signal });
    },
  };
}

type ClientFactory = (apiKey: string) => LlmClient;

/** 라우트마다 번들이 나뉘어도 같은 팩토리를 쓰도록 globalThis에 둔다. 테스트에서 교체한다. */
const holder = globalThis as unknown as { __illionaireLlmFactory?: ClientFactory };

export function setClientFactory(factory: ClientFactory | null) {
  holder.__illionaireLlmFactory = factory ?? undefined;
}

export function createClient(apiKey: string): LlmClient {
  return (holder.__illionaireLlmFactory ?? sdkClient)(apiKey);
}

export function textOf(message: Pick<Message, 'content'>): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
