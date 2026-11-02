import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * 보안 프록시 (Next 16 — 구 middleware) — 일리네어는 사용자 기기 안에서만 동작하도록 강제한다.
 *
 * LAN 접근을 막는 것은 서버를 루프백에 바인드하는 것(`-H 127.0.0.1`)이다. 프록시는 상대의 주소를 볼 수 없고,
 * Host 헤더는 상대가 마음대로 적을 수 있으므로 Host 검사만으로는 LAN을 막지 못한다.
 *
 * 1) 서버가 루프백이 아닌 주소에서 듣고 있는데 세션 토큰이 없으면 /api/* 를 전부 거부
 *    (실수로 `next dev`처럼 열어 둔 경우에 LAN에서 도구를 실행하지 못하게 한다)
 * 2) Host 헤더가 loopback이 아니면 거부
 *    (DNS 리바인딩 방어: 브라우저가 공격자 도메인으로 이 서버에 붙으면 Host에 그 도메인이 온다)
 * 3) /api/* 는 Sec-Fetch-Site가 다른 사이트이면 GET도 거부
 *    (방문한 악성 사이트가 진행 상황이나 데이터를 엿보는 것 차단)
 * 4) 변경 요청(POST/PUT/PATCH/DELETE)은 Origin의 스킴과 호스트가 앱 자신과 같아야 함
 *    (같은 PC의 다른 포트에서 도는 페이지도 차단)
 * 5) ILLIONAIRE_SESSION_TOKEN이 있으면(데스크톱 앱) /api/* 에 세션 쿠키를 요구
 *    (같은 PC의 다른 사용자, 다른 프로세스 차단)
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_COOKIE = 'illionaire_session';
const LISTEN_CACHE_MS = 5000;

/**
 * host 헤더 값에서 포트를 뗀 호스트 이름. IPv6 대괄호 표기를 처리한다.
 * `localhost:80@evil.example`처럼 URL 구성 요소가 섞인 값은 빈 문자열이다.
 */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (/[@/\\?#\s]/.test(value)) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end === -1) return '';
    const rest = value.slice(end + 1);
    if (rest && !/^:\d+$/.test(rest)) return '';
    return value.slice(1, end);
  }
  const parts = value.split(':');
  // 대괄호 없이 콜론이 둘 이상이면 포트 없는 IPv6 주소이다.
  if (parts.length > 2) return value;
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) return '';
  return parts[0];
}

function isLocalHost(host: string | null): boolean {
  return host ? LOCAL_HOSTS.has(hostnameOf(host)) : false;
}

function isLoopbackAddress(address: string): boolean {
  const value = address.toLowerCase();
  return value === '::1' || value === 'localhost' || value.startsWith('127.') || value.startsWith('::ffff:127.');
}

let listenCache: { at: number; exposed: boolean } | null = null;

/** 테스트용. 캐시를 비운다. */
export function resetListenCache(): void {
  listenCache = null;
}

/**
 * 이 프로세스의 서버가 루프백이 아닌 주소에서 듣고 있는가.
 * Node의 비공개 API라 없으면 false로 친다. 비용이 있어 잠깐 기억해 둔다.
 */
export function listensBeyondLoopback(now = Date.now()): boolean {
  if (listenCache && now - listenCache.at < LISTEN_CACHE_MS) return listenCache.exposed;
  let exposed = false;
  try {
    const source = process as unknown as { _getActiveHandles?: () => unknown[] };
    for (const handle of source._getActiveHandles?.() ?? []) {
      const server = handle as { listening?: unknown; address?: unknown } | null;
      if (server?.listening !== true || typeof server.address !== 'function') continue;
      const bound = (server.address as () => unknown).call(server);
      // 유닉스 소켓은 문자열 주소이고 네트워크에 열리지 않는다.
      if (bound && typeof bound === 'object' && 'address' in bound && !isLoopbackAddress(String(bound.address))) {
        exposed = true;
        break;
      }
    }
  } catch {
    exposed = false;
  }
  listenCache = { at: now, exposed };
  return exposed;
}

function forbidden(reason: string) {
  return new NextResponse(`Forbidden: ${reason}`, { status: 403 });
}

/** 길이가 같을 때 끝까지 비교한다. 비교 시간으로 토큰을 알아내지 못하게 한다. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const token = process.env.ILLIONAIRE_SESSION_TOKEN;

  if (isApi && !token && listensBeyondLoopback()) {
    return NextResponse.json(
      {
        error: {
          code: 'not_loopback',
          message:
            '서버가 다른 기기에서도 접속할 수 있게 열려 있어 요청을 막았어요. 이 앱은 이 컴퓨터 안에서만 동작해요. `next dev -H 127.0.0.1` 또는 `next start -H 127.0.0.1`로 다시 실행해 주세요.',
        },
      },
      { status: 403 }
    );
  }

  const host = req.headers.get('host');
  if (!isLocalHost(host)) return forbidden('non-local host');

  const fetchSite = req.headers.get('sec-fetch-site');
  const method = req.method.toUpperCase();

  if (isApi && (fetchSite === 'cross-site' || fetchSite === 'same-site')) {
    return forbidden('cross-site request');
  }

  if (MUTATING.has(method)) {
    const origin = req.headers.get('origin');
    if (origin) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return forbidden('invalid origin');
      }
      if (parsed.protocol !== req.nextUrl.protocol) return forbidden('cross-origin scheme');
      if (parsed.host.toLowerCase() !== (host ?? '').toLowerCase()) return forbidden('cross-origin');
    }
    // Origin 없는 요청(예: curl)은 Sec-Fetch-Site로 추가 검사
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return forbidden('untrusted fetch site');
    }
  }

  if (token && isApi) {
    const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? '';
    if (!safeEqual(cookie, token)) return forbidden('invalid session');
  }

  return NextResponse.next();
}

export const config = {
  // / 와 /api/* 만 검사. 정적 자산(_next/*)은 통과.
  matcher: ['/', '/api/:path*'],
};
