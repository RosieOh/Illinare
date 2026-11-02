import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostnameOf, listensBeyondLoopback, proxy, resetListenCache } from '@/proxy';

const PROCESS = process as unknown as { _getActiveHandles?: () => unknown[] };

function request(path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new NextRequest(`http://127.0.0.1:3000${path}`, { method, headers: { host: '127.0.0.1:3000', ...headers } });
}

function fakeServer(address: unknown) {
  return { listening: true, address: () => address };
}

describe('Host 파싱', () => {
  it.each([
    'localhost:80@evil.example',
    'evil.example@127.0.0.1',
    '127.0.0.1@evil.example:3000',
    'localhost/evil',
    'localhost\\evil',
    'localhost?x',
    'localhost#x',
    'local host',
    'localhost:abc',
    '[::1]x',
    '[::1]:abc',
  ])('%s를 로컬로 보지 않는다', (host) => {
    expect(hostnameOf(host)).toBe('');
  });

  it('정상 값은 그대로 읽는다', () => {
    expect(hostnameOf('localhost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
  });

  it('@가 든 Host를 거부한다', () => {
    expect(proxy(request('/api/tasks', 'GET', { host: 'localhost:80@evil.example' })).status).toBe(403);
    expect(proxy(request('/', 'GET', { host: 'evil.example@127.0.0.1' })).status).toBe(403);
  });
});

describe('Origin 스킴', () => {
  it('호스트가 같아도 스킴이 다르면 거부한다', () => {
    expect(proxy(request('/api/tasks', 'POST', { origin: 'https://127.0.0.1:3000' })).status).toBe(403);
    expect(proxy(request('/api/tasks', 'POST', { origin: 'http://127.0.0.1:3000' })).status).toBe(200);
  });
});

describe('루프백이 아닌 주소에서 듣고 있을 때', () => {
  const original = PROCESS._getActiveHandles;

  beforeEach(() => {
    resetListenCache();
  });

  afterEach(() => {
    PROCESS._getActiveHandles = original;
    delete process.env.ILLIONAIRE_SESSION_TOKEN;
    resetListenCache();
  });

  it('재현: 0.0.0.0에 열려 있으면 Host를 속여도 API가 막힌다', async () => {
    PROCESS._getActiveHandles = () => [fakeServer({ address: '0.0.0.0', family: 'IPv4', port: 3000 })];
    const res = proxy(request('/api/data/export', 'GET', { host: '127.0.0.1:3000' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_loopback');
    expect(body.error.message).toContain('-H 127.0.0.1');
  });

  it.each(['::', '192.168.0.5', '0.0.0.0'])('%s는 막는다', (address) => {
    PROCESS._getActiveHandles = () => [fakeServer({ address, family: 'IPv4', port: 3000 })];
    expect(listensBeyondLoopback()).toBe(true);
  });

  it.each(['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])('%s는 통과한다', (address) => {
    PROCESS._getActiveHandles = () => [fakeServer({ address, family: 'IPv4', port: 3000 })];
    expect(listensBeyondLoopback()).toBe(false);
    expect(proxy(request('/api/tasks')).status).toBe(200);
  });

  it('세션 토큰이 있으면 쿠키 검사에 맡긴다', () => {
    PROCESS._getActiveHandles = () => [fakeServer({ address: '0.0.0.0', family: 'IPv4', port: 3000 })];
    process.env.ILLIONAIRE_SESSION_TOKEN = 'tok';
    expect(proxy(request('/api/tasks', 'GET', { cookie: 'illionaire_session=tok' })).status).toBe(200);
    expect(proxy(request('/api/tasks')).status).toBe(403);
  });

  it('페이지는 막지 않아 안내를 볼 수 있다', () => {
    PROCESS._getActiveHandles = () => [fakeServer({ address: '0.0.0.0', family: 'IPv4', port: 3000 })];
    expect(proxy(request('/')).status).toBe(200);
  });

  it('API가 없거나 예외를 던져도 안전하다', () => {
    PROCESS._getActiveHandles = undefined;
    expect(listensBeyondLoopback()).toBe(false);
    resetListenCache();
    PROCESS._getActiveHandles = () => {
      throw new Error('boom');
    };
    expect(listensBeyondLoopback()).toBe(false);
    resetListenCache();
    PROCESS._getActiveHandles = () => [null, 1, {}, { listening: true }, { listening: false, address: () => ({ address: '0.0.0.0' }) }, fakeServer(null), fakeServer('/tmp/sock')];
    expect(listensBeyondLoopback()).toBe(false);
  });

  it('결과를 5초 기억한다', () => {
    let calls = 0;
    PROCESS._getActiveHandles = () => {
      calls++;
      return [];
    };
    expect(listensBeyondLoopback(1000)).toBe(false);
    expect(listensBeyondLoopback(5999)).toBe(false);
    expect(calls).toBe(1);
    expect(listensBeyondLoopback(6000)).toBe(false);
    expect(calls).toBe(2);
  });
});
