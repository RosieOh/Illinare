import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { hostnameOf, proxy } from '@/proxy';

function request(
  path: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { host: '127.0.0.1:3000', ...headers },
  });
}

function status(req: NextRequest): number {
  return proxy(req).status;
}

describe('hostnameOf', () => {
  it('handles IPv4, names, and IPv6 with or without a port', () => {
    expect(hostnameOf('127.0.0.1:3000')).toBe('127.0.0.1');
    expect(hostnameOf('LOCALHOST:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('[::1]')).toBe('::1');
    expect(hostnameOf('::1')).toBe('::1');
    expect(hostnameOf('[::1')).toBe('');
  });
});

describe('proxy', () => {
  afterEach(() => {
    delete process.env.ILLIONAIRE_SESSION_TOKEN;
  });

  it('accepts loopback hosts including IPv6', () => {
    expect(status(request('/'))).toBe(200);
    expect(status(request('/api/tasks', { headers: { host: 'localhost:3000' } }))).toBe(200);
    expect(status(request('/api/tasks', { headers: { host: '[::1]:3000' } }))).toBe(200);
  });

  it('rejects non-local hosts (DNS rebinding, LAN)', () => {
    expect(status(request('/', { headers: { host: 'evil.example' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { host: '192.168.0.5:3000' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { host: 'localhost.evil.example' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { host: '[::2]:3000' } }))).toBe(403);
  });

  it('rejects cross-site GET on the API but not on the page', () => {
    expect(status(request('/api/tasks', { headers: { 'sec-fetch-site': 'cross-site' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { 'sec-fetch-site': 'same-site' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { 'sec-fetch-site': 'same-origin' } }))).toBe(200);
    expect(status(request('/api/tasks', { headers: { 'sec-fetch-site': 'none' } }))).toBe(200);
    expect(status(request('/', { headers: { 'sec-fetch-site': 'cross-site' } }))).toBe(200);
  });

  it('requires a same-origin Origin on mutations', () => {
    const post = (headers: Record<string, string>) => status(request('/api/tasks', { method: 'POST', headers }));
    expect(post({ origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' })).toBe(200);
    expect(post({ origin: 'https://evil.example' })).toBe(403);
    // 같은 PC의 다른 포트도 다른 출처이다.
    expect(post({ origin: 'http://127.0.0.1:5173' })).toBe(403);
    expect(post({ origin: 'http://localhost:3000' })).toBe(403);
    expect(post({ origin: 'null' })).toBe(403);
    // Origin 없는 요청은 Sec-Fetch-Site로 판단한다.
    expect(post({})).toBe(200);
    expect(post({ 'sec-fetch-site': 'same-site' })).toBe(403);
  });

  it('enforces the session token only when configured', () => {
    process.env.ILLIONAIRE_SESSION_TOKEN = 'secret-token';
    expect(status(request('/api/tasks'))).toBe(403);
    expect(status(request('/api/tasks', { headers: { cookie: 'illionaire_session=wrong-token!' } }))).toBe(403);
    expect(status(request('/api/tasks', { headers: { cookie: 'illionaire_session=secret-token' } }))).toBe(200);
    // 페이지 자체는 토큰 없이도 열린다 (Electron이 쿠키를 먼저 심는다).
    expect(status(request('/'))).toBe(200);
  });
});
