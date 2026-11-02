import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedRelative, isCommonFolder, isInside, isWriteBlockedRelative, safePath, safeWritePath } from '@/lib/tools/paths';

const win = { api: path.win32, caseInsensitive: true };
const mac = { api: path.posix, caseInsensitive: true };
const linux = { api: path.posix, caseInsensitive: false };

describe('isInside', () => {
  it('separator-aware containment', () => {
    expect(isInside('/home/a', '/home/a/x', linux)).toBe(true);
    expect(isInside('/home/a', '/home/a', linux)).toBe(true);
    expect(isInside('/home/a', '/home/ab/x', linux)).toBe(false);
    expect(isInside('/home/a', '/home/a/../b', linux)).toBe(false);
    // `..foo`는 위로 올라가는 경로가 아니다.
    expect(isInside('/home/a', '/home/a/..foo', linux)).toBe(true);
  });

  it('Windows separators and drive letters', () => {
    expect(isInside('C:\\Users\\me', 'C:\\Users\\me\\Desktop\\a.txt', win)).toBe(true);
    expect(isInside('C:\\Users\\me', 'C:/Users/me/Desktop/a.txt', win)).toBe(true);
    expect(isInside('C:\\Users\\me', 'C:\\Users\\me2\\a.txt', win)).toBe(false);
    expect(isInside('C:\\Users\\me', 'D:\\Users\\me\\a.txt', win)).toBe(false);
    expect(isInside('C:\\Users\\me', 'c:\\USERS\\ME\\a.txt', win)).toBe(true);
  });

  it('case folding depends on the OS', () => {
    expect(isInside('/Users/me', '/users/ME/x', mac)).toBe(true);
    expect(isInside('/home/me', '/home/ME/x', linux)).toBe(false);
  });
});

describe('isBlockedRelative', () => {
  it.each([
    '.ssh/id_rsa',
    '.aws/credentials',
    '.gnupg/secring.gpg',
    '.kube/config',
    '.docker/config.json',
    '.azure/accessTokens.json',
    '.config/gh/hosts.yml',
    '.npmrc',
    '.netrc',
    '.pypirc',
    '.git-credentials',
    '.env',
    '.env.local',
    'projects/app/.env',
    'projects/app/.env.production',
    'projects/certs/server.pem',
    'Library/Keychains/login.keychain-db',
    '.mozilla/firefox/profile',
  ])('blocks %s', (rel) => {
    expect(isBlockedRelative(rel, linux)).toBe(true);
  });

  it('blocks case variants on case-insensitive systems', () => {
    expect(isBlockedRelative('.SSH/id_rsa', mac)).toBe(true);
    expect(isBlockedRelative('LIBRARY/keychains/x', mac)).toBe(true);
    expect(isBlockedRelative('.ENV', win)).toBe(true);
  });

  it('blocks Windows credential and browser profile folders', () => {
    expect(isBlockedRelative('AppData\\Roaming\\Microsoft\\Credentials\\abc', win)).toBe(true);
    expect(isBlockedRelative('AppData\\Roaming\\Microsoft\\Protect\\abc', win)).toBe(true);
    expect(isBlockedRelative('AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data', win)).toBe(true);
    expect(isBlockedRelative('AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cookies', win)).toBe(true);
  });

  it('Windows ignores trailing dots and spaces, so must we', () => {
    expect(isBlockedRelative('.env.', win)).toBe(true);
    expect(isBlockedRelative('.env ', win)).toBe(true);
    expect(isBlockedRelative('.ssh.\\id_rsa', win)).toBe(true);
  });

  it('allows ordinary documents', () => {
    expect(isBlockedRelative('Documents/report.md', linux)).toBe(false);
    expect(isBlockedRelative('Desktop/environment.txt', linux)).toBe(false);
    expect(isBlockedRelative('.envelope', linux)).toBe(false);
    expect(isBlockedRelative('Documents\\report.txt', win)).toBe(false);
  });
});

describe('isWriteBlockedRelative', () => {
  it('blocks shell init and autostart paths', () => {
    expect(isWriteBlockedRelative('.zshrc', linux)).toBe(true);
    expect(isWriteBlockedRelative('Library/LaunchAgents/evil.plist', mac)).toBe(true);
    expect(
      isWriteBlockedRelative('AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\evil.bat', win)
    ).toBe(true);
    expect(isWriteBlockedRelative('Documents\\WindowsPowerShell\\profile.ps1', win)).toBe(true);
    expect(isWriteBlockedRelative('Documents/report.md', linux)).toBe(false);
  });
});

describe('safePath on this machine', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const savedHome = process.env[homeKey];
  let root: string;
  let home: string;
  let outside: string;

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'illionaire-paths-')));
    home = path.join(root, 'home');
    outside = path.join(root, 'outside');
    mkdirSync(path.join(home, 'Desktop'), { recursive: true });
    mkdirSync(path.join(home, 'AppData', 'Local'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    writeFileSync(path.join(home, 'Desktop', 'a.txt'), 'hello');
    process.env[homeKey] = home;
  });

  afterAll(() => {
    process.env[homeKey] = savedHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('expands ~ and accepts both separators', () => {
    expect(safePath('~/Desktop/a.txt')).toBe(path.join(home, 'Desktop', 'a.txt'));
    expect(safePath('~\\Desktop\\a.txt'.replaceAll('\\', path.sep))).toBe(path.join(home, 'Desktop', 'a.txt'));
    expect(safePath('~')).toBe(home);
  });

  it('resolves relative paths against home, not the working directory', () => {
    expect(safePath('Desktop/a.txt')).toBe(path.join(home, 'Desktop', 'a.txt'));
  });

  it('allows paths that do not exist yet', () => {
    expect(safePath('~/Desktop/new/deep/file.txt')).toBe(path.join(home, 'Desktop', 'new', 'deep', 'file.txt'));
  });

  it('rejects traversal out of home', () => {
    expect(() => safePath('~/../outside/secret.txt')).toThrow(/밖의 경로/);
    expect(() => safePath(path.join(outside, 'secret.txt'))).toThrow(/밖의 경로/);
    expect(() => safePath('~/Desktop/../../outside/secret.txt')).toThrow(/밖의 경로/);
  });

  it('rejects sibling directories that share a prefix', () => {
    mkdirSync(`${home}2`, { recursive: true });
    expect(() => safePath(`${home}2`)).toThrow(/밖의 경로/);
  });

  it('rejects links that escape home', () => {
    // 정션은 Windows에서 관리자 권한 없이 만들 수 있다.
    const link = path.join(home, 'escape');
    symlinkSync(outside, link, 'junction');
    expect(() => safePath('~/escape/secret.txt')).toThrow(/밖의 경로/);
    expect(() => safePath('~/escape/new-file.txt')).toThrow(/밖의 경로/);
  });

  it('rejects blocked names even when reached with a different case', () => {
    expect(() => safePath('~/.ssh/id_rsa')).toThrow(/보호된 경로/);
    expect(() => safePath('~/.env')).toThrow(/보호된 경로/);
    expect(() => safePath('~/project/.env.local')).toThrow(/보호된 경로/);
    if (process.platform !== 'linux') expect(() => safePath('~/.SSH/id_rsa')).toThrow(/보호된 경로/);
  });

  it('rejects the app data directory', () => {
    const saved = process.env.ILLIONAIRE_DATA_DIR;
    process.env.ILLIONAIRE_DATA_DIR = path.join(home, 'AppData', 'Roaming', 'Illionaire');
    try {
      expect(() => safePath('~/AppData/Roaming/Illionaire/secrets.json')).toThrow(/보호된 경로/);
    } finally {
      process.env.ILLIONAIRE_DATA_DIR = saved;
    }
  });

  it('rejects NUL bytes and empty input', () => {
    expect(() => safePath('')).toThrow();
    expect(() => safePath('~/a\0.txt')).toThrow();
  });

  it.runIf(process.platform === 'win32')('rejects NTFS streams and device names', () => {
    expect(() => safePath('~/Desktop/a.txt:hidden')).toThrow(/쓸 수 없는 문자/);
    expect(() => safePath('~/.env::$DATA')).toThrow();
    expect(() => safePath('~/Desktop/CON')).toThrow(/장치 이름/);
    expect(() => safePath('~/Desktop/nul.txt')).toThrow(/장치 이름/);
    expect(() => safePath('~/.env.')).toThrow(/보호된 경로/);
    expect(() => safePath('~/.ssh /key')).toThrow(/보호된 경로/);
  });

  it('safeWritePath refuses persistence locations', () => {
    expect(() => safeWritePath('~/.zshrc')).toThrow(/쓸 수 없어요/);
    expect(safeWritePath('~/Desktop/ok.txt')).toBe(path.join(home, 'Desktop', 'ok.txt'));
  });

  it('isCommonFolder recognizes everyday folders', () => {
    expect(isCommonFolder('~/Desktop/a.txt')).toBe(true);
    expect(isCommonFolder('~/Documents/x.md')).toBe(true);
    expect(isCommonFolder('~/AppData/Local/x.txt')).toBe(false);
    expect(isCommonFolder('~/../outside/secret.txt')).toBe(false);
  });
});
