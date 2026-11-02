import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { appRootDir, dataDir } from '@/lib/store/json';

/**
 * 경로 보호막.
 * - 사용자 홈 밖은 거부한다. 심볼릭 링크와 정션은 실제 경로로 풀어서 검사한다.
 * - 키 자료, 브라우저 프로필, 앱 자체 데이터는 읽기와 쓰기 모두 거부한다.
 * - 쓰기는 기본 거부다. 바탕 화면, 문서처럼 사용자가 눈으로 보는 폴더 안에서만 허용하고,
 *   그 안에서도 숨김 파일과 실행 파일은 막는다. 나머지 홈 폴더에는 PATH, 자동 실행, 도구 설정처럼
 *   파일을 쓰는 것만으로 코드가 실행되는 자리가 너무 많아 하나씩 막을 수 없다.
 */

/** 경로 어디에 있어도 막는 이름 */
const BLOCKED_NAMES = new Set(
  [
    '.ssh',
    '.aws',
    '.gnupg',
    '.kube',
    '.docker',
    '.azure',
    '.npmrc',
    '.netrc',
    '_netrc',
    '.pypirc',
    '.git-credentials',
    '.env',
    '.envrc',
    '.pgpass',
    '.my.cnf',
    '.vault-token',
    'id_rsa',
    'id_ecdsa',
    'id_ed25519',
    'id_dsa',
    // 브라우저와 메일 프로필의 비밀번호, 쿠키 저장소
    'user data',
    'login data',
    'cookies',
    'key4.db',
    'logins.json',
  ].map((n) => n.toLowerCase())
);

const BLOCKED_NAME_PATTERNS = [/^\.env\..+/i, /\.(pem|p12|pfx|key|ppk|kdbx)$/i];

/** 홈 기준 상대 경로 접두사. 항상 소문자, / 구분으로 적는다. */
const BLOCKED_PREFIXES = [
  '.config/gh',
  '.config/gcloud',
  '.config/rclone',
  '.config/filezilla',
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.terraform.d/credentials.tfrc.json',
  '.claude/.credentials.json',
  'library/keychains',
  'library/cookies',
  // Windows 자격 증명
  'appdata/roaming/microsoft/credentials',
  'appdata/local/microsoft/credentials',
  'appdata/roaming/microsoft/protect',
  'appdata/roaming/microsoft/vault',
  'appdata/local/microsoft/vault',
  'appdata/roaming/github cli',
  'appdata/roaming/gcloud',
  'appdata/roaming/rclone',
  'appdata/roaming/filezilla',
  // 브라우저 프로필 (쿠키, 저장된 비밀번호)
  'appdata/local/google/chrome/user data',
  'appdata/local/microsoft/edge/user data',
  'appdata/local/naver/naver whale/user data',
  'appdata/local/vivaldi/user data',
  'appdata/local/bravesoftware',
  'appdata/roaming/mozilla/firefox',
  'appdata/roaming/opera software',
  'appdata/roaming/thunderbird/profiles',
  'library/application support/google/chrome',
  'library/application support/microsoft edge',
  'library/application support/bravesoftware',
  'library/application support/firefox',
  'library/thunderbird/profiles',
  'library/safari',
  '.config/google-chrome',
  '.config/chromium',
  '.config/microsoft-edge',
  '.config/bravesoftware',
  '.mozilla',
  '.thunderbird',
  // 리눅스 Electron의 userData는 앱 폴더(appRootDir)와 다른 곳에 있다.
  '.config/illionaire',
];

/** 쓰기를 허용하는 사용자 폴더. 홈 바로 아래이거나 OneDrive 안에 있다. */
const WRITABLE_FOLDERS = new Set(
  [
    'desktop',
    'documents',
    'downloads',
    'pictures',
    'videos',
    'movies',
    'music',
    '바탕 화면',
    '바탕화면',
    '문서',
    '다운로드',
    '사진',
    '비디오',
    '동영상',
    '음악',
  ].map((n) => n.normalize('NFC'))
);

/** 승인 없이 읽어도 되는 일상 폴더 */
const COMMON_READ_FOLDERS = new Set(
  ['desktop', 'documents', 'downloads', '바탕 화면', '바탕화면', '문서', '다운로드'].map((n) => n.normalize('NFC'))
);

/** OneDrive, OneDrive - 회사이름 */
const ONEDRIVE_FOLDER = /^onedrive( - .+)?$/i;

/** 쓰면 로그인할 때 코드가 실행되는 폴더 */
const CODE_RUNNING_FOLDERS = new Set(['windowspowershell', 'powershell', 'start menu']);

/** 실행되거나 실행을 일으키는 파일 형식 */
const EXECUTABLE_FILE =
  /\.(lnk|bat|cmd|ps1|psm1|vbs|vbe|jse|wsf|wsh|hta|exe|com|pif|scr|msi|msp|dll|cpl|msc|reg|scf|url|inf|jar|desktop|plist|service|command|appref-ms)$/i;
const EXECUTABLE_NAMES = new Set(['desktop.ini']);

const WINDOWS_DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[\d¹²³]|lpt[\d¹²³])(\..*)?$/i;

export interface PathRules {
  api: path.PlatformPath;
  caseInsensitive: boolean;
}

function hostRules(): PathRules {
  return { api: path, caseInsensitive: process.platform === 'win32' || process.platform === 'darwin' };
}

/** parent 안에 있는가. 구분자를 고려하며 `..foo` 같은 이름은 안쪽으로 친다. */
export function isInside(parent: string, child: string, rules: PathRules = hostRules()): boolean {
  const fold = (s: string) => (rules.caseInsensitive ? s.toLowerCase() : s);
  const rel = rules.api.relative(fold(parent), fold(child));
  if (rel === '') return true;
  if (rules.api.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${rules.api.sep}`);
}

/** 비교용 경로 조각. Windows는 끝의 점과 공백을 무시하므로(`.env.` == `.env`) 지운 뒤 비교한다. */
function segmentsOf(rel: string, rules: PathRules): string[] {
  const windows = rules.api === path.win32;
  return rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((s) => (windows ? s.replace(/[. ]+$/, '') : s))
    .filter(Boolean)
    .map((s) => (rules.caseInsensitive ? s.toLowerCase() : s));
}

function matchesPrefix(segments: string[], prefix: string, caseInsensitive: boolean): boolean {
  const parts = prefix.split('/');
  if (segments.length < parts.length) return false;
  return parts.every((p, i) => (caseInsensitive ? segments[i] === p : segments[i].toLowerCase() === p));
}

/** 홈 기준 상대 경로가 차단 대상인가 */
export function isBlockedRelative(rel: string, rules: PathRules = hostRules()): boolean {
  const segments = segmentsOf(rel, rules);
  const blockedName = segments.some(
    (s) => BLOCKED_NAMES.has(s.toLowerCase()) || BLOCKED_NAME_PATTERNS.some((re) => re.test(s))
  );
  if (blockedName) return true;
  return BLOCKED_PREFIXES.some((p) => matchesPrefix(segments, p, rules.caseInsensitive));
}

/** 경로를 [허용 폴더까지, 그 안쪽]으로 나눈다. 허용 폴더 밖이면 null */
function splitUserFolder(segments: string[], folders: Set<string>): string[] | null {
  const lower = segments.map((s) => s.toLowerCase().normalize('NFC'));
  const rootIndex = ONEDRIVE_FOLDER.test(lower[0] ?? '') ? 1 : 0;
  if (!folders.has(lower[rootIndex] ?? '')) return null;
  return lower.slice(rootIndex + 1);
}

export type WriteRefusal = 'outside' | 'hidden' | 'code-folder' | 'executable';

/** 홈 기준 상대 경로에 쓸 수 없는 이유. 쓸 수 있으면 null */
export function writeRefusal(rel: string, rules: PathRules = hostRules()): WriteRefusal | null {
  const inner = splitUserFolder(segmentsOf(rel, rules), WRITABLE_FOLDERS);
  // 폴더 자체를 파일로 덮어쓸 수는 없다.
  if (!inner || inner.length === 0) return 'outside';
  if (inner.some((s) => s.startsWith('.'))) return 'hidden';
  if (inner.some((s) => CODE_RUNNING_FOLDERS.has(s))) return 'code-folder';
  // macOS는 .app 폴더 자체가 실행 파일이다.
  if (inner.some((s) => s.endsWith('.app'))) return 'executable';
  const leaf = inner[inner.length - 1];
  if (EXECUTABLE_NAMES.has(leaf) || EXECUTABLE_FILE.test(leaf)) return 'executable';
  return null;
}

export function isWriteBlockedRelative(rel: string, rules: PathRules = hostRules()): boolean {
  return writeRefusal(rel, rules) !== null;
}

function refusalMessage(reason: WriteRefusal, target: string): string {
  switch (reason) {
    case 'outside':
      return `이 위치에는 파일을 쓸 수 없어요: ${target}. 에이전트는 바탕 화면, 문서, 다운로드, 사진, 동영상, 음악 폴더 안에만 쓸 수 있어요. 그 안의 경로로 다시 맡기거나, 이 파일은 직접 수정해 주세요.`;
    case 'hidden':
      return `숨김 파일과 설정 폴더(.git, .vscode 등)에는 쓸 수 없어요: ${target}. 꼭 바꿔야 하면 직접 수정해 주세요.`;
    case 'code-folder':
      return `PowerShell 프로필과 시작 메뉴는 로그인할 때 코드가 실행되는 곳이라 쓸 수 없어요: ${target}. 꼭 바꿔야 하면 직접 수정해 주세요.`;
    case 'executable':
      return `실행 파일과 바로가기(.bat, .exe, .lnk 등)는 만들거나 바꿀 수 없어요: ${target}. 꼭 필요하면 직접 만들어 주세요.`;
  }
}

/**
 * 가장 깊은 실존 조상까지 realpath로 풀고 나머지를 붙인다.
 * 대상이 깨진 심볼릭 링크이면 쓰기가 링크를 따라 밖으로 나갈 수 있으므로 거부한다.
 */
function resolveReal(abs: string): string {
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(realpathSync.native(cur), ...rest.reverse());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
      let dangling = false;
      try {
        dangling = lstatSync(cur).isSymbolicLink();
      } catch {
        dangling = false;
      }
      if (dangling) throw new Error(`연결이 끊어진 바로가기 경로는 사용할 수 없습니다: ${cur}`);
      const parent = path.dirname(cur);
      if (parent === cur) throw err;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function realOrSame(abs: string): string {
  try {
    return resolveReal(abs);
  } catch {
    return abs;
  }
}

/** 앱의 데이터와 프로필은 에이전트가 건드릴 수 없다. 홈이 정션이어도 실제 경로끼리 비교한다. */
function isAppOwned(abs: string, real: string): boolean {
  return [dataDir(), appRootDir()].some(
    (root) => isInside(root, abs) || isInside(root, real) || isInside(realOrSame(root), real)
  );
}

function expandHome(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(home, input.slice(2));
  return input;
}

/**
 * 하드 링크는 이름만 다른 같은 파일이라 경로 검사로는 구분되지 않는다.
 * 링크 수가 2 이상인 일반 파일만 장치와 아이노드로 보호 대상과 비교한다.
 * Windows의 아이노드는 2^53을 넘어 Number로 읽으면 서로 다른 파일이 같아질 수 있으므로 bigint로 읽는다.
 */
function fileIdentity(real: string): { id: string; linked: boolean } | null {
  try {
    const stat = statSync(real, { bigint: true });
    return stat.isFile() ? { id: `${stat.dev}:${stat.ino}`, linked: Number(stat.nlink) > 1 } : null;
  } catch {
    return null;
  }
}

/** 쓰면 코드가 실행되는 잘 알려진 자리. 쓰기 규칙은 경로로 막지만 하드 링크는 경로가 다르다. */
const CODE_RUNNING_TARGETS = [
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.gitconfig',
  '.config/git',
  '.config/fish',
  '.config/autostart',
  '.claude/settings.json',
  'Library/LaunchAgents',
  'Documents/PowerShell',
  'Documents/WindowsPowerShell',
  'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup',
];

/** 보호 대상을 훑는 한도. 하드 링크를 만났을 때만 돌지만 경로 검사는 동기라 오래 걸리면 안 된다. */
const INODE_SCAN_DEPTH = 3;
const INODE_SCAN_ENTRIES = 2000;
const INODE_CACHE_MS = 3000;

function collectInodes(root: string, into: Set<string>) {
  const queue: [string, number][] = [[root, 0]];
  let visited = 0;
  for (let i = 0; i < queue.length && visited < INODE_SCAN_ENTRIES; i++) {
    const [cur, depth] = queue[i];
    visited++;
    try {
      const stat = statSync(cur, { bigint: true });
      if (stat.isFile()) into.add(`${stat.dev}:${stat.ino}`);
      else if (stat.isDirectory() && depth < INODE_SCAN_DEPTH) {
        for (const name of readdirSync(cur)) queue.push([path.join(cur, name), depth + 1]);
      }
    } catch {
      /* 없거나 읽을 수 없는 항목 */
    }
  }
}

let inodeCache: { key: string; at: number; ids: Set<string> } | null = null;

/** 지금 존재하는 보호 대상의 장치+아이노드. 앱 자신의 데이터(secrets.json 포함)를 가장 먼저 본다. */
function protectedInodes(): Set<string> {
  const home = homedir();
  const key = `${home}|${dataDir()}`;
  if (inodeCache && inodeCache.key === key && Date.now() - inodeCache.at < INODE_CACHE_MS) return inodeCache.ids;
  const ids = new Set<string>();
  for (const root of [
    dataDir(),
    appRootDir(),
    ...[...BLOCKED_NAMES, ...BLOCKED_PREFIXES, ...CODE_RUNNING_TARGETS].map((rel) => path.join(home, rel)),
  ]) {
    collectInodes(root, ids);
  }
  inodeCache = { key, at: Date.now(), ids };
  return ids;
}

export function resetProtectedInodesForTests() {
  inodeCache = null;
}

/**
 * 사용자가 준 경로를 실제 경로로 바꾼다. 허용되지 않으면 throw 한다.
 * 상대 경로는 작업 폴더가 아니라 홈 기준으로 해석한다.
 */
export function safePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('경로가 비어 있습니다');
  if (input.includes('\0')) throw new Error('경로에 쓸 수 없는 문자가 있습니다');

  const home = homedir();
  const abs = path.resolve(home, expandHome(input.trim(), home));

  if (process.platform === 'win32') {
    // 드라이브 표시 외의 콜론은 대체 데이터 스트림(`.env::$DATA`)이다. 장치 이름도 파일이 아니다.
    if (abs.slice(2).includes(':')) throw new Error(`경로에 쓸 수 없는 문자가 있습니다: ${input}`);
    if (segmentsOf(abs.slice(3), hostRules()).some((s) => WINDOWS_DEVICE.test(s))) {
      throw new Error(`장치 이름은 경로로 쓸 수 없습니다: ${input}`);
    }
  }

  const outside = () => new Error(`사용자 홈(${home}) 밖의 경로는 접근할 수 없습니다: ${abs}`);
  if (!isInside(home, abs)) throw outside();

  const realHome = realpathSync.native(home);
  const real = resolveReal(abs);
  if (!isInside(realHome, real)) throw outside();

  const protectedPath = () => new Error(`보호된 경로입니다: ${abs}`);
  if (isBlockedRelative(path.relative(home, abs)) || isBlockedRelative(path.relative(realHome, real))) {
    throw protectedPath();
  }
  if (isAppOwned(abs, real)) throw protectedPath();
  const identity = fileIdentity(real);
  if (identity?.linked && protectedInodes().has(identity.id)) {
    throw new Error(`보호된 파일(키 자료, 앱 데이터 등)을 가리키는 하드 링크라 열 수 없어요: ${abs}`);
  }

  // Node는 끝의 점과 공백을 그대로 전달해 탐색기로 지울 수 없는 파일이 생기고, 다른 Windows API는 그것을 지운 이름으로 해석한다.
  if (process.platform === 'win32' && real.slice(3).split(path.sep).some((s) => /[. ]$/.test(s))) {
    throw new Error(`경로 이름 끝에는 점이나 공백을 쓸 수 없습니다: ${input}`);
  }

  return real;
}

/**
 * 허용된 경로인데 다른 이름과 내용을 공유하는 파일인가. 다른 이름이 어디 있는지는 알 수 없으므로 승인으로 넘긴다.
 * 경로가 틀리면 false다. 실행 단계의 safePath가 오류로 알린다.
 */
export function isHardLink(input: string): boolean {
  try {
    return fileIdentity(safePath(input))?.linked ?? false;
  } catch {
    return false;
  }
}

/** 쓰기용 검사. 읽기 금지 경로에 더해, 허용 폴더 밖과 코드가 실행되는 자리를 막는다. */
export function safeWritePath(input: string): string {
  const real = safePath(input);
  const reason = writeRefusal(path.relative(realpathSync.native(homedir()), real));
  if (reason) throw new Error(refusalMessage(reason, real));
  return real;
}

/** 승인 없이 읽어도 되는 일상 폴더(바탕 화면, 문서, 다운로드) 안인가. 그 안의 숨김 폴더는 뺀다. */
export function isCommonFolder(input: string): boolean {
  try {
    const real = safePath(input);
    const rel = path.relative(realpathSync.native(homedir()), real);
    const inner = splitUserFolder(segmentsOf(rel, { ...hostRules(), caseInsensitive: true }), COMMON_READ_FOLDERS);
    return inner !== null && !inner.some((s) => s.startsWith('.'));
  } catch {
    return false;
  }
}

/** 차단 대상이 아니면 true. 검색, 목록 결과를 거를 때 쓴다. */
export function isReadable(absPath: string): boolean {
  try {
    safePath(absPath);
    return true;
  } catch {
    return false;
  }
}

/** 바탕 화면 폴더. OneDrive로 옮겨졌을 수 있다. */
export function desktopDir(): string {
  const home = homedir();
  const candidates = [path.join(home, 'Desktop')];
  try {
    for (const entry of readdirSync(home)) {
      if (ONEDRIVE_FOLDER.test(entry)) {
        candidates.push(path.join(home, entry, 'Desktop'), path.join(home, entry, '바탕 화면'));
      }
    }
  } catch {
    /* 홈을 읽을 수 없으면 기본 위치를 쓴다 */
  }
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}
