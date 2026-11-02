import { describe, expect, it, vi, beforeEach } from 'vitest';
import { darwinPlatform } from '@/lib/platform/darwin';
import { run, runWithStdin } from '@/lib/platform/exec';
import { linuxPlatform } from '@/lib/platform/linux';
import { ps } from '@/lib/platform/powershell';
import { webUrl } from '@/lib/platform/url';
import { win32Platform } from '@/lib/platform/win32';

// 실제 프로세스를 띄우지 않는다. 무엇을 넘기는지만 본다.
vi.mock('@/lib/platform/powershell', () => ({ ps: vi.fn(async () => '') }));
vi.mock('@/lib/platform/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/exec')>()),
  run: vi.fn(async () => ({ stdout: '', stderr: '' })),
  runWithStdin: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webUrl', () => {
  it('파싱한 결과만 돌려준다', () => {
    expect(webUrl('https://example.com')).toBe('https://example.com/');
    expect(webUrl('HTTP://EXAMPLE.com/a b?q=가')).toBe('http://example.com/a%20b?q=%EA%B0%80');
  });

  it.each(['file:///C:/x', 'javascript:alert(1)', 'ms-settings:', 'shell:AppsFolder', 'calc.exe', '', 'https://a@b.example', 'https://a:b@c.example'])(
    '%s를 거부한다',
    (url) => {
      expect(() => webUrl(url)).toThrow();
    }
  );
});

describe('win32', () => {
  const lastCall = () => vi.mocked(ps).mock.calls[0];

  it('openApp은 시작 메뉴 앱만 실행하고 이름을 그대로 실행하지 않는다', async () => {
    await win32Platform.openApp('메모장');
    const [script, vars] = lastCall();
    expect(vars).toEqual({ NAME: '메모장' });
    expect(script).toContain('Get-StartApps');
    expect(script).toContain('shell:AppsFolder');
    // 재현 경로: PATH의 .bat이 Start-Process로 실행됐다.
    expect(script).not.toMatch(/Start-Process\s+-FilePath\s+\$n\b/);
    expect(script.match(/Start-Process/g)).toHaveLength(1);
    expect(script).not.toContain('메모장');
  });

  it('openUrl은 정규화한 주소만 넘긴다', async () => {
    await win32Platform.openUrl('HTTPS://Example.com/a b');
    expect(lastCall()[1]).toEqual({ URL: 'https://example.com/a%20b' });
    await expect(win32Platform.openUrl('file:///C:/Windows/notepad.exe')).rejects.toThrow();
    await expect(win32Platform.openUrl('https://naver.com@evil.example')).rejects.toThrow();
    expect(ps).toHaveBeenCalledTimes(1);
  });
});

describe('darwin', () => {
  it('openApp은 앱 번들만 찾는 -a를 쓴다', async () => {
    await darwinPlatform.openApp('Safari');
    expect(run).toHaveBeenCalledWith('/usr/bin/open', ['-a', 'Safari']);
  });

  it('openUrl은 정규화한 주소만 넘긴다', async () => {
    await darwinPlatform.openUrl('HTTPS://Example.com/a b');
    expect(run).toHaveBeenCalledWith('/usr/bin/open', ['https://example.com/a%20b']);
    await expect(darwinPlatform.openUrl('file:///etc/passwd')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clipboardWrite는 표준 입력으로 넘긴다', async () => {
    await darwinPlatform.clipboardWrite('글');
    expect(runWithStdin).toHaveBeenCalledWith('/usr/bin/pbcopy', [], '글');
  });
});

describe('linux', () => {
  it('openApp은 .desktop 항목만 찾는 gtk-launch를 쓴다', async () => {
    await linuxPlatform.openApp('firefox');
    expect(run).toHaveBeenCalledWith('gtk-launch', ['--', 'firefox']);
  });

  it('openUrl은 정규화한 주소만 넘긴다', async () => {
    await linuxPlatform.openUrl('HTTPS://Example.com/a b');
    expect(run).toHaveBeenCalledWith('xdg-open', ['https://example.com/a%20b']);
    await expect(linuxPlatform.openUrl('file:///etc/passwd')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
