import Anthropic from '@anthropic-ai/sdk';
import { ApiError, handle, readBody } from '@/lib/server/http';
import { apiKeyInfo, clearApiKey, setApiKey } from '@/lib/store/secrets';

export const dynamic = 'force-dynamic';

const ENV_CONFLICT = '환경 변수 ANTHROPIC_API_KEY가 설정되어 있어 그 키를 사용해요. 환경 변수를 먼저 지워 주세요.';

/** 저장하기 전에 Models API로 키가 실제로 동작하는지 확인한다. */
async function verifyKey(apiKey: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10000 });
  try {
    await client.models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ApiError(400, 'invalid_key', 'API 키가 유효하지 않아요. 키를 다시 확인해 주세요.');
    }
    // 요청 한도 초과는 키 자체가 유효하다는 뜻이다.
    if (err instanceof Anthropic.RateLimitError) return;
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ApiError(503, 'network', 'Anthropic 서버에 연결할 수 없어 키를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.');
    }
    throw new ApiError(502, 'verify_failed', '키를 확인하는 중 Anthropic 서버에서 오류가 났어요. 잠시 후 다시 시도해 주세요.');
  }
}

export const PUT = handle(async (request: Request) => {
  const { key } = await readBody<{ key?: unknown }>(request);
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (trimmed.length < 20 || trimmed.length > 300 || /\s/.test(trimmed)) {
    throw new ApiError(400, 'invalid_key', 'API 키 형식이 올바르지 않아요. Anthropic 콘솔에서 복사한 키를 붙여넣어 주세요.');
  }
  if ((await apiKeyInfo()).source === 'env') throw new ApiError(409, 'env_key', ENV_CONFLICT);
  await verifyKey(trimmed);
  const hint = await setApiKey(trimmed);
  return Response.json({ ok: true, hint });
});

export const DELETE = handle(async () => {
  if ((await apiKeyInfo()).source === 'env') throw new ApiError(409, 'env_key', ENV_CONFLICT);
  await clearApiKey();
  return Response.json({ ok: true });
});
