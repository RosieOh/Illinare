import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * 보안 프록시 (Next 16 — 구 middleware) — 일리네어는 본인 맥에서만 동작하도록 강제.
 *
 * 1) Host 헤더가 loopback이 아니면 거부
 *    (dev 서버가 0.0.0.0에 바인드되어 있어도 LAN 요청을 차단)
 * 2) 변경 요청(POST/PUT/PATCH/DELETE)은 Origin도 loopback이어야 함
 *    (사용자가 방문한 악성 사이트가 fetch로 localhost를 때리는 것 차단)
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHostname(host: string | null): boolean {
  if (!host) return false;
  const stripped = host.split(':')[0].replace(/^\[|\]$/g, '');
  return LOCAL_HOSTS.has(stripped);
}

export function proxy(req: NextRequest) {
  const host = req.headers.get('host');
  if (!isLocalHostname(host)) {
    return new NextResponse('Forbidden: non-local host', { status: 403 });
  }

  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = req.headers.get('origin');
    if (origin) {
      try {
        const u = new URL(origin);
        if (!isLocalHostname(u.host)) {
          return new NextResponse('Forbidden: cross-origin', { status: 403 });
        }
      } catch {
        return new NextResponse('Forbidden: invalid origin', { status: 403 });
      }
    }
    // origin이 없는 요청(예: curl)은 Sec-Fetch-Site로 추가 검사
    const sfs = req.headers.get('sec-fetch-site');
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
      return new NextResponse('Forbidden: untrusted fetch site', { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // / 와 /api/* 만 검사. 정적 자산(_next/*)은 통과.
  matcher: ['/', '/api/:path*'],
};
