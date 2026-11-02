import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 앱 폴더. Windows와 macOS에서는 Electron 프로필(쿠키, 캐시)도 이 안에 있으므로 통째로 지우면 안 된다. */
export function appRootDir(): string {
  const home = homedir();
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Illionaire');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Illionaire');
  }
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'illionaire');
}

/**
 * 로컬 데이터 저장소. 사용자 데이터는 전부 이 디렉터리 아래에 JSON으로 저장한다.
 * 웹 모드와 데스크톱 앱이 같은 위치를 쓴다.
 * - ILLIONAIRE_DATA_DIR 로 덮어쓸 수 있다 (테스트, Electron).
 */
export function dataDir(): string {
  return process.env.ILLIONAIRE_DATA_DIR ?? join(appRootDir(), 'data');
}

export function dataPath(...segments: string[]): string {
  return join(dataDir(), ...segments);
}

/**
 * 파일별 직렬화 큐 — 같은 파일의 동시 쓰기가 서로를 덮어쓰지 않도록 한다.
 * Next는 라우트마다 모듈을 따로 번들할 수 있으므로 프로세스 전역에 둔다.
 */
const globalStore = globalThis as typeof globalThis & { __illionaireJsonQueues?: Map<string, Promise<unknown>> };
const queues = (globalStore.__illionaireJsonQueues ??= new Map<string, Promise<unknown>>());

function enqueue<T>(file: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(
    file,
    next.catch(() => undefined)
  );
  return next;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    // 손상된 파일을 조용히 덮어쓰지 않도록 옆으로 치워둔다.
    if (err instanceof SyntaxError) {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
      return fallback;
    }
    throw err;
  }
}

/** Windows에서는 다른 핸들이 열려 있으면 rename이 잠깐 실패할 수 있어 재시도한다. */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retriable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retriable || attempt >= 6) {
        await fs.rm(from, { force: true }).catch(() => undefined);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
}

async function atomicWrite(file: string, content: string, mode: number) {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode });
  await renameWithRetry(tmp, file);
}

/** 원자적 쓰기. mode 0600 — 같은 기기의 다른 사용자가 읽지 못하게 한다. */
export function writeJson<T>(file: string, data: T): Promise<void> {
  return enqueue(file, () => atomicWrite(file, JSON.stringify(data, null, 2), 0o600));
}

/** 읽고-고치고-쓰기를 파일 단위로 직렬화한다. */
export function updateJson<T>(file: string, fallback: T, fn: (current: T) => T): Promise<T> {
  return enqueue(file, async () => {
    const next = fn(await readJson(file, fallback));
    await atomicWrite(file, JSON.stringify(next, null, 2), 0o600);
    return next;
  });
}

/**
 * 읽기와 쓰기 사이에 비동기 작업이 있는 갱신(키 암호화 등). 파일 큐를 잡고 있으므로
 * job 안에서 같은 파일에 writeJson이나 updateJson을 부르면 영원히 기다린다. 넘겨받은 write를 쓴다.
 */
export function withJsonFile<T, R>(
  file: string,
  fallback: T,
  job: (current: T, write: (next: T) => Promise<void>) => Promise<R>
): Promise<R> {
  return enqueue(file, async () =>
    job(await readJson(file, fallback), (next) => atomicWrite(file, JSON.stringify(next, null, 2), 0o600))
  );
}

export function appendLine(file: string, line: string): Promise<void> {
  return enqueue(file, async () => {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.appendFile(file, line.endsWith('\n') ? line : `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
