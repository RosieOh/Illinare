import { describe, expect, it } from 'vitest';
import { linkCheck } from '@/components/glass/link-check';

describe('linkCheck', () => {
  it('글자가 곧 주소인 평범한 링크는 바로 연다', () => {
    expect(linkCheck('https://example.com/a', 'https://example.com/a')).toEqual({
      href: 'https://example.com/a',
      host: null,
      needsConfirm: false,
    });
    expect(linkCheck('https://example.com/', 'example.com').needsConfirm).toBe(false);
  });

  it('글자와 주소가 다르면 호스트를 보여 주고 확인받는다', () => {
    const c = linkCheck('https://evil.example/c', '공식 보고서');
    expect(c.host).toBe('evil.example');
    expect(c.needsConfirm).toBe(true);
  });

  it('주소에 데이터를 실을 수 있으면 글자가 같아도 확인받는다', () => {
    const url = 'https://evil.example/c?d=secret';
    expect(linkCheck(url, url).needsConfirm).toBe(true);
    expect(linkCheck('https://evil.example/#secret', 'https://evil.example/#secret').needsConfirm).toBe(true);
    expect(linkCheck('https://user:pw@evil.example/', 'https://user:pw@evil.example/').needsConfirm).toBe(true);
  });

  it('위험한 스킴과 미리 채운 메일을 막는다', () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'data:text/html,x', 'vbscript:x', 'not a url', undefined]) {
      expect(linkCheck(bad, 'x').href).toBeNull();
    }
    expect(linkCheck('mailto:a@b.co?body=secret', 'a').href).toBeNull();
    expect(linkCheck('mailto:a@b.co', 'a').href).toBe('mailto:a@b.co');
  });

  it('유니코드 호스트는 퓨니코드로 보여 준다', () => {
    expect(linkCheck('https://аррle.com/', '애플').host).toMatch(/^xn--/);
  });
});
