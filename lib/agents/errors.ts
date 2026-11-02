import Anthropic from '@anthropic-ai/sdk';
import type { MissionErrorCode } from '@/lib/contracts';

/** 모델이 안전 정책으로 응답을 거절했다. 그 턴의 도구는 절대 실행하지 않는다. */
export class RefusedError extends Error {
  constructor(readonly category: string | null) {
    super('refused');
    this.name = 'RefusedError';
  }
}

/** 끝까지 가지 못했지만 그때까지의 본문이 남아 있는 실행 */
export class IncompleteRunError extends Error {
  constructor(
    message: string,
    readonly partialText = ''
  ) {
    super(message);
    this.name = 'IncompleteRunError';
  }
}

/** 도구 입력이 max_tokens나 컨텍스트 한도에서 잘렸다. */
export class TruncatedError extends IncompleteRunError {
  constructor(partialText = '') {
    super('truncated', partialText);
    this.name = 'TruncatedError';
  }
}

export class TurnLimitError extends IncompleteRunError {
  constructor(partialText = '') {
    super('turn limit', partialText);
    this.name = 'TurnLimitError';
  }
}

/** 다시 물어봐도 모델이 본문을 내지 않았고 실행한 도구도 없다. */
export class EmptyResponseError extends Error {
  constructor() {
    super('empty response');
    this.name = 'EmptyResponseError';
  }
}

export class BudgetExceededError extends Error {
  constructor(readonly budgetUsd: number) {
    super('budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** SDK가 부분 JSON을 끝내 해석하지 못했을 때만 true. 끊어진 연결도 같은 클래스로 오므로 문구로 구분한다. */
export function isUnparseableToolInput(err: unknown): boolean {
  return (
    err instanceof Anthropic.AnthropicError &&
    !(err instanceof Anthropic.APIError) &&
    err.message.includes('Unable to parse tool parameter JSON')
  );
}

const TRANSIENT_STREAM_TYPES: readonly (string | null)[] = ['overloaded_error', 'api_error', 'timeout_error'];

/**
 * 스트림 도중의 일시적 실패. 응답이 시작된 뒤의 오류는 SDK가 재시도하지 않는다.
 * 모델 호출에는 부수효과가 없으므로 (도구는 finalMessage 뒤에만 실행) 다시 보내도 안전하다.
 */
export function isTransientStreamError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // status가 있거나 연결 오류면 SDK가 이미 재시도한 뒤다.
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionError) return false;
    return err.status === undefined && TRANSIENT_STREAM_TYPES.includes(err.type as string | null);
  }
  // SDK는 끊어진 연결(TypeError: terminated)을 AnthropicError로 감싼다.
  return err instanceof Anthropic.AnthropicError && !isUnparseableToolInput(err);
}

export function isCancellation(err: unknown): boolean {
  return (
    err instanceof CancelledError ||
    err instanceof Anthropic.APIUserAbortError ||
    (err instanceof DOMException && err.name === 'AbortError')
  );
}

/** API가 보낸 오류 문구. 키처럼 보이는 값은 지우고 길이를 제한한다. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const raw = typeof body?.error?.message === 'string' ? body.error.message : err.message;
  return String(raw).replace(/sk-ant-[\w-]+/g, 'sk-ant-…').slice(0, 300);
}

function describeApiError(err: InstanceType<typeof Anthropic.APIError>): { code: MissionErrorCode; message: string } {
  const type = err.type as string | null;
  // 첫 실패를 진단할 수 있도록 서버 콘솔에는 전부 남긴다. 프롬프트나 키는 들어 있지 않다.
  console.error('[mission] Claude API 오류', {
    status: err.status,
    type,
    requestId: err.requestID,
    message: apiMessage(err),
  });

  if (type === 'authentication_error' || type === 'permission_error' || err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return {
      code: 'invalid_api_key',
      message: 'Anthropic API 키가 유효하지 않거나 권한이 없어요. 설정에서 키를 확인해 주세요.',
    };
  }
  if (type === 'billing_error') {
    return { code: 'invalid_api_key', message: 'API 크레딧이 부족해요. Anthropic Console에서 결제 상태를 확인해 주세요.' };
  }
  if (type === 'rate_limit_error' || err instanceof Anthropic.RateLimitError) {
    return { code: 'rate_limited', message: 'API 사용량 한도에 걸렸어요. 잠시 후 다시 시도하거나 Console에서 한도를 확인해 주세요.' };
  }
  if (type === 'overloaded_error' || err.status === 529) {
    return { code: 'overloaded', message: 'Claude 서버가 혼잡해요. 잠시 후 다시 시도해 주세요.' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: 'network', message: 'Claude 서버에 연결할 수 없어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
  const status = err.status ? ` ${err.status}` : '';
  return { code: 'internal', message: `Claude API가 요청을 받지 않았어요 (오류${status}): ${apiMessage(err)}` };
}

/** 사용자에게 보여줄 코드와 문구. 예상하지 못한 내부 오류는 내용을 드러내지 않는다. */
export function describeError(err: unknown): { code: MissionErrorCode; message: string } {
  if (err instanceof BudgetExceededError) {
    return {
      code: 'budget_exceeded',
      message: `이번 작업의 비용 상한($${err.budgetUsd.toFixed(2)})에 닿았거나 다음 호출이 상한을 넘을 것 같아 멈췄어요. 설정에서 상한을 올린 뒤 후속 지시로 이어갈 수 있어요.`,
    };
  }
  if (err instanceof RefusedError) {
    return { code: 'refused', message: '안전 정책 때문에 이 요청을 수행할 수 없어요. 요청을 바꿔서 다시 시도해 주세요.' };
  }
  if (err instanceof TruncatedError) {
    return { code: 'internal', message: '작업 지시가 너무 길어 응답이 잘렸어요. 일을 더 작게 나눠서 다시 시도해 주세요.' };
  }
  if (err instanceof TurnLimitError) {
    return { code: 'internal', message: '이 단계가 너무 길어져 멈췄어요. 목표를 좁혀서 다시 시도해 주세요.' };
  }
  if (err instanceof EmptyResponseError) {
    return { code: 'internal', message: '모델이 빈 응답을 보냈어요. 다시 시도해 주세요.' };
  }
  if (err instanceof Anthropic.APIError) return describeApiError(err);
  if (isUnparseableToolInput(err)) {
    console.error('[mission] 도구 입력 해석 실패', err);
    return { code: 'internal', message: '모델이 보낸 도구 입력을 해석하지 못했어요. 다시 시도해 주세요.' };
  }
  if (err instanceof Anthropic.AnthropicError) {
    console.error('[mission] 스트림 끊김', err);
    return { code: 'network', message: 'Claude 서버와의 연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
  console.error('[mission]', err);
  return { code: 'internal', message: '처리 중 문제가 발생했어요. 다시 시도해 주세요.' };
}
