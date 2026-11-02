/** Route handler 공통 응답 헬퍼. 오류 message는 사용자에게 그대로 보여줄 수 있는 한국어여야 한다. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error('[api]', err);
  return Response.json(
    { error: { code: 'internal', message: '처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' } },
    { status: 500 }
  );
}

/** 핸들러를 감싸 오류를 표준 형태로 바꾼다. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readBody<T>(request: Request, maxBytes = 2_000_000): Promise<T> {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new ApiError(413, 'too_large', '요청이 너무 커요.');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, 'invalid_json', '요청 형식이 올바르지 않아요.');
  }
}
