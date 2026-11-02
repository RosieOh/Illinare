import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedRelative, isCommonFolder, safePath, safeWritePath, writeRefusal } from '@/lib/tools/paths';

const win = { api: path.win32, caseInsensitive: true };
const linux = { api: path.posix, caseInsensitive: false };

describe('writeRefusal: 쓰기는 기본 거부', () => {
  it.each([
    'Desktop\\a.txt',
    'Documents\\보고서.md',
    'Documents\\프로젝트\\초안\\a.docx',
    'Downloads\\a.csv',
    'Pictures\\a.png',
    'Videos\\a.txt',
    'Music\\a.txt',
    'OneDrive\\Documents\\a.txt',
    'OneDrive\\문서\\a.txt',
    'OneDrive\\바탕 화면\\a.txt',
    'OneDrive - Contoso\\Documents\\a.txt',
    'OneDrive - 주식회사\\문서\\a.txt',
  ])('allows %s', (rel) => {
    expect(writeRefusal(rel, win)).toBeNull();
  });

  it.each([
    // 리뷰에서 실제로 쓸 수 있었던 경로
    ['AppData\\Local\\Microsoft\\WindowsApps\\git.bat', 'outside'],
    ['AppData\\Roaming\\npm\\node.cmd', 'outside'],
    ['.config\\git\\config', 'outside'],
    ['.claude\\settings.json', 'outside'],
    ['AppData\\Local\\Programs\\Illionaire\\resources\\server\\server.js', 'outside'],
    ['AppData\\Roaming\\Code\\User\\settings.json', 'outside'],
    ['.cargo\\bin\\x.txt', 'outside'],
    ['report.txt', 'outside'],
    ['OneDrive\\a.txt', 'outside'],
    ['OneDriveBackup\\Documents\\a.txt', 'outside'],
    // 폴더 자체
    ['Documents', 'outside'],
    ['OneDrive\\Documents', 'outside'],
    // 허용 폴더 안에서도 안 되는 것
    ['Documents\\project\\.git\\hooks\\pre-commit', 'hidden'],
    ['Documents\\project\\.vscode\\tasks.json', 'hidden'],
    ['Documents\\.hidden.txt', 'hidden'],
    ['OneDrive\\Documents\\WindowsPowerShell\\profile.txt', 'code-folder'],
    ['OneDrive - Contoso\\Documents\\PowerShell\\profile.txt', 'code-folder'],
    ['Documents\\Start Menu\\a.txt', 'code-folder'],
    ['Documents\\POWERSHELL.\\a.txt', 'code-folder'],
    ['Desktop\\x.lnk', 'executable'],
    ['Desktop\\x.bat', 'executable'],
    ['Desktop\\x.BAT', 'executable'],
    ['Desktop\\x.bat.', 'executable'],
    ['Desktop\\x.bat ', 'executable'],
    ['Downloads\\x.cmd', 'executable'],
    ['Downloads\\x.ps1', 'executable'],
    ['Downloads\\x.vbs', 'executable'],
    ['Downloads\\x.exe', 'executable'],
    ['Downloads\\x.scr', 'executable'],
    ['Downloads\\x.msi', 'executable'],
    ['Downloads\\x.dll', 'executable'],
    ['Downloads\\x.desktop', 'executable'],
    ['Downloads\\x.plist', 'executable'],
    ['Downloads\\x.service', 'executable'],
    ['Downloads\\x.hta', 'executable'],
    ['Downloads\\x.reg', 'executable'],
    ['Documents\\Evil.app\\Contents\\Info.txt', 'executable'],
    ['Documents\\desktop.ini', 'executable'],
  ])('refuses %s as %s', (rel, reason) => {
    expect(writeRefusal(rel, win)).toBe(reason);
  });

  it('applies on Linux too', () => {
    expect(writeRefusal('Documents/a.txt', linux)).toBeNull();
    expect(writeRefusal('문서/a.txt', linux)).toBeNull();
    expect(writeRefusal('.local/share/applications/evil.txt', linux)).toBe('outside');
    expect(writeRefusal('.config/Illionaire/x.txt', linux)).toBe('outside');
    expect(writeRefusal('Documents/run.desktop', linux)).toBe('executable');
  });
});

describe('isBlockedRelative: 비밀 파일', () => {
  it.each([
    '_netrc',
    'Documents/server.key',
    'Documents/putty.ppk',
    'Documents/vault.kdbx',
    '.pgpass',
    '.vault-token',
    '.envrc',
    'project/.envrc',
    '.claude/.credentials.json',
    '.my.cnf',
    'AppData/Roaming/GitHub CLI/hosts.yml',
    'AppData/Roaming/gcloud/credentials.db',
    'AppData/Roaming/rclone/rclone.conf',
    'AppData/Roaming/FileZilla/sitemanager.xml',
    'AppData/Local/Naver/Naver Whale/User Data/Default/Login Data',
    'AppData/Local/Vivaldi/User Data/Default/Login Data',
    'AppData/Roaming/Thunderbird/Profiles/x/prefs.js',
    'somewhere/key4.db',
    'somewhere/logins.json',
    'AppData/Local/SomeBrowser/User Data/Default/History',
    'Backups/Login Data',
    'Backups/Cookies',
    '.config/Illionaire/data/secrets.json',
    '.config/illionaire/logs/server.log',
  ])('blocks %s', (rel) => {
    expect(isBlockedRelative(rel, win)).toBe(true);
    expect(isBlockedRelative(rel, linux)).toBe(true);
  });

  it('keeps ordinary neighbours readable', () => {
    expect(isBlockedRelative('Documents/keynote.txt', win)).toBe(false);
    expect(isBlockedRelative('Documents/cookies.txt', win)).toBe(false);
    expect(isBlockedRelative('Documents/user data notes.txt', win)).toBe(false);
    expect(isBlockedRelative('.claude/settings.json', win)).toBe(false);
  });
});

describe('safeWritePath와 safePath: 실제 파일 시스템', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const saved = { home: process.env[homeKey], appdata: process.env.APPDATA, xdg: process.env.XDG_DATA_HOME, data: process.env.ILLIONAIRE_DATA_DIR };
  let root: string;
  let home: string;

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'illionaire-write-')));
    home = path.join(root, 'home');
    mkdirSync(path.join(home, 'Documents'), { recursive: true });
    mkdirSync(path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps'), { recursive: true });
    process.env[homeKey] = home;
  });

  afterAll(() => {
    process.env[homeKey] = saved.home;
    if (saved.appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved.appdata;
    if (saved.xdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved.xdg;
    process.env.ILLIONAIRE_DATA_DIR = saved.data;
    rmSync(root, { recursive: true, force: true });
  });

  it('says what the user can do', () => {
    expect(() => safeWritePath('~/AppData/Local/Microsoft/WindowsApps/git.bat')).toThrow(/바탕 화면, 문서, 다운로드.*직접 수정/);
    expect(() => safeWritePath('~/Documents/.git/hooks/pre-commit')).toThrow(/숨김 파일.*직접 수정/);
    expect(() => safeWritePath('~/Documents/run.bat')).toThrow(/실행 파일.*직접 만들어/);
    expect(() => safeWritePath('~/Documents/PowerShell/profile.txt')).toThrow(/PowerShell 프로필/);
    expect(safeWritePath('~/Documents/ok.txt')).toBe(path.join(home, 'Documents', 'ok.txt'));
  });

  it('judges the path after resolving traversal', () => {
    expect(() => safeWritePath('~/Documents/x.txt/../../.claude/settings.json')).toThrow(/쓸 수 없어요/);
    expect(safeWritePath('~/Documents/a/../b.txt')).toBe(path.join(home, 'Documents', 'b.txt'));
  });

  it('judges the path after resolving links', () => {
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    symlinkSync(path.join(home, '.claude'), path.join(home, 'Documents', 'jn'), 'junction');
    expect(() => safeWritePath('~/Documents/jn/settings.json')).toThrow(/쓸 수 없어요/);
  });

  it('protects app data even when home is reached through a junction', () => {
    const appdata = path.join(home, 'AppData', 'Roaming');
    const secret = path.join(appdata, 'Illionaire', 'data', 'secrets.json');
    mkdirSync(path.dirname(secret), { recursive: true });
    writeFileSync(secret, '{}');
    process.env.APPDATA = appdata;
    process.env.XDG_DATA_HOME = path.join(home, '.local', 'share');
    delete process.env.ILLIONAIRE_DATA_DIR;

    const linked = path.join(root, 'homelink');
    symlinkSync(home, linked, 'junction');
    process.env[homeKey] = linked;
    process.env.APPDATA = path.join(linked, 'AppData', 'Roaming');
    process.env.XDG_DATA_HOME = path.join(linked, '.local', 'share');
    try {
      expect(() => safePath('~/AppData/Roaming/Illionaire/data/secrets.json')).toThrow(/보호된 경로/);
      expect(() => safePath(path.join(linked, 'AppData', 'Roaming', 'Illionaire', 'data', 'secrets.json'))).toThrow(/보호된 경로/);
    } finally {
      process.env[homeKey] = home;
      process.env.ILLIONAIRE_DATA_DIR = saved.data;
    }
  });

  it.runIf(process.platform === 'win32')('refuses every Windows device alias and trailing dots or spaces', () => {
    for (const name of ['~/CONIN$', '~/CONOUT$', '~/CLOCK$', '~/COM¹', '~/LPT²', '~/COM0', '~/Documents/NUL/x', '~/Documents/con.txt']) {
      expect(() => safePath(name), name).toThrow(/장치 이름/);
    }
    for (const name of ['~/Documents/report.txt.', '~/Documents./report.txt', '~/AppData/Roaming/Illionaire./data/secrets.json', '~/Documents/a /b.txt']) {
      expect(() => safePath(name), name).toThrow();
    }
    expect(() => safeWritePath('~/Documents/w2.txt.')).toThrow(/점이나 공백/);
  });

  it('reads inside hidden folders of common folders are not treated as everyday reads', () => {
    expect(isCommonFolder('~/Documents/report.txt')).toBe(true);
    expect(isCommonFolder('~/Documents/.git/config')).toBe(false);
    expect(isCommonFolder('~/OneDrive - Contoso/문서/a.txt')).toBe(true);
    expect(isCommonFolder('~')).toBe(false);
  });
});
