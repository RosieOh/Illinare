import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ApiKeyStorage } from '@/lib/contracts';
import { platformVault, type KeyVault, type SealedKey } from '@/lib/platform/keystore';
import { ApiError } from '@/lib/server/http';
import { dataPath, withJsonFile } from './json';

/**
 * API 키 저장. 환경 변수 ANTHROPIC_API_KEY가 있으면 그것이 우선이다.
 * 가능하면 OS 보호 저장소(DPAPI, 키체인, Secret Service)에 넣고, 쓸 수 없으면 mode 0600 파일에 평문으로 둔다.
 * 어느 쪽인지는 apiKeyInfo().storage로 알린다. Windows에서는 0600이 적용되지 않아 %APPDATA%의 사용자 ACL에 의존한다.
 */
interface SecretsFile {
  /** 보호 저장소를 쓸 수 없을 때만 쓰는 평문 */
  anthropicApiKey?: string;
  sealedApiKey?: SealedKey;
}

const file = () => dataPath('secrets.json');

function envKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

interface KeyState {
  key: string | null;
  storage: ApiKeyStorage;
}

interface CachedKey extends KeyState {
  file: string;
  /** 읽을 때의 파일 상태. 웹 모드와 데스크톱 앱이 같은 파일을 쓰므로 다른 프로세스의 변경도 알아채야 한다. */
  stamp: string | null;
}

/**
 * 복호화한 키의 메모리 캐시. Windows에서는 읽을 때마다 PowerShell을 띄우므로 필요하다.
 * Next는 라우트마다 모듈을 따로 번들할 수 있으므로 프로세스 전역에 둔다.
 */
const globalStore = globalThis as typeof globalThis & { __illionaireKeyCache?: { entry: CachedKey | null } };
const cache = (globalStore.__illionaireKeyCache ??= { entry: null });

export function forgetCachedKeyForTests() {
  cache.entry = null;
}

async function stampOf(path: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function remember(path: string, state: KeyState): Promise<KeyState> {
  cache.entry = { ...state, file: path, stamp: await stampOf(path) };
  return state;
}

async function freshCache(path: string): Promise<KeyState | null> {
  const entry = cache.entry;
  return entry && entry.file === path && entry.stamp === (await stampOf(path)) ? entry : null;
}

/** 저장소가 이 키를 다시 돌려줄 때만 성공으로 친다. 호출자는 그 뒤에 평문을 지운다. */
async function seal(key: string): Promise<SealedKey | null> {
  const vault = platformVault();
  if (!vault) return null;
  try {
    const sealed = await vault.save(key);
    if ((await vault.load(sealed)) !== key) {
      await vault.remove().catch(() => undefined);
      throw new Error('read-back mismatch');
    }
    return sealed;
  } catch {
    // 도구의 오류 출력에 무엇이 섞일지 알 수 없으므로 내용은 남기지 않는다.
    console.error(`[secrets] ${vault.scheme}에 키를 넣지 못해 파일에 보관해요`);
    return null;
  }
}

/** 이 파일을 쓴 저장소가 지금도 있으면 돌려준다. 폴더를 다른 OS에서 가져왔으면 null이다. */
function vaultOf(sealed: SealedKey): KeyVault | null {
  const vault = platformVault();
  return vault?.scheme === sealed.scheme ? vault : null;
}

/** 저장된 키를 읽는다. 평문이 있으면 이때 보호 저장소로 옮긴다. */
function loadStored(): Promise<KeyState> {
  const path = file();
  return withJsonFile<SecretsFile, KeyState>(path, {}, async (current, write) => {
    // 큐에서 기다리는 사이 앞선 호출이 이미 풀었을 수 있다. PowerShell을 여러 번 띄우지 않는다.
    const fresh = await freshCache(path);
    if (fresh) return fresh;

    const { anthropicApiKey: plain, sealedApiKey: sealed, ...rest } = current;
    if (sealed) {
      try {
        const vault = vaultOf(sealed);
        if (!vault) throw new Error('vault unavailable');
        const key = await vault.load(sealed);
        // 옮기는 도중 끊겼으면 평문이 함께 남아 있을 수 있다.
        if (plain !== undefined) await write({ ...rest, sealedApiKey: sealed });
        return remember(path, { key, storage: sealed.scheme });
      } catch {
        if (plain !== undefined) return remember(path, { key: plain, storage: 'file' });
        // 잠긴 키체인처럼 일시적일 수 있으므로 지우지 않고, 다음에 다시 시도하도록 캐시하지 않는다.
        console.error(`[secrets] ${sealed.scheme}에서 키를 읽지 못했어요`);
        return { key: null, storage: 'unreadable' };
      }
    }
    if (plain === undefined) return remember(path, { key: null, storage: 'none' });

    const moved = await seal(plain);
    if (!moved) return remember(path, { key: plain, storage: 'file' });
    await write({ ...rest, sealedApiKey: moved });
    return remember(path, { key: plain, storage: moved.scheme });
  });
}

async function readKey(): Promise<KeyState> {
  return (await freshCache(file())) ?? (await loadStored());
}

export async function getApiKey(): Promise<string | null> {
  return envKey() ?? (await readKey()).key;
}

function maskKey(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export async function apiKeyInfo(): Promise<{
  hasApiKey: boolean;
  source: 'env' | 'stored' | 'none';
  hint: string | null;
  storage: ApiKeyStorage;
}> {
  const env = envKey();
  if (env) {
    // 환경 변수를 쓰는 동안에도 파일에 남은 평문은 옮겨 둔다.
    void readKey().catch(() => undefined);
    return { hasApiKey: true, source: 'env', hint: maskKey(env), storage: 'env' };
  }
  const { key, storage } = await readKey();
  if (key) return { hasApiKey: true, source: 'stored', hint: maskKey(key), storage };
  return { hasApiKey: false, source: 'none', hint: null, storage };
}

export async function setApiKey(key: string): Promise<string> {
  const path = file();
  await withJsonFile<SecretsFile, void>(path, {}, async (current, write) => {
    const previous = current.sealedApiKey;
    const sealed = await seal(key);
    const next = { ...current };
    delete next.anthropicApiKey;
    delete next.sealedApiKey;
    await write(sealed ? { ...next, sealedApiKey: sealed } : { ...next, anthropicApiKey: key });
    // 파일로 물러났는데 예전 키가 OS 저장소에 남아 있으면 지운 줄 아는 키가 살아 있게 된다.
    if (!sealed && previous) {
      await vaultOf(previous)
        ?.remove()
        .catch(() => console.error(`[secrets] ${previous.scheme}의 예전 키를 지우지 못했어요`));
    }
    await remember(path, { key, storage: sealed?.scheme ?? 'file' });
  });
  return maskKey(key);
}

/** 손상되어 치운 사본(secrets.json.corrupt-*)과 쓰다 남은 임시 파일에도 평문 키가 있을 수 있다. */
async function removeKeyFiles(path: string) {
  const prefix = `${basename(path)}.`;
  const names = await fs.readdir(dirname(path)).catch(() => [] as string[]);
  await Promise.all(
    names.filter((name) => name.startsWith(prefix)).map((name) => fs.rm(join(dirname(path), name), { force: true }))
  );
  await fs.rm(path, { force: true });
}

const NOT_REMOVED = 'OS 키 저장소에서 키를 지우지 못했어요. 키 저장소가 잠겨 있으면 풀고 다시 시도해 주세요.';

/** 파일과 보호된 사본을 모두 지운다. 지우지 못하면 지운 척하지 않고 알린다. */
export async function clearApiKey(): Promise<void> {
  const path = file();
  await withJsonFile<SecretsFile, void>(path, {}, async (current) => {
    const sealed = current.sealedApiKey;
    if (sealed) {
      const vault = vaultOf(sealed);
      // 암호문이 파일 안에 있는 dpapi만 도구 없이도 지울 수 있다.
      if (!vault && sealed.scheme !== 'dpapi') throw new ApiError(500, 'key_not_removed', NOT_REMOVED);
      await vault?.remove().catch(() => {
        throw new ApiError(500, 'key_not_removed', NOT_REMOVED);
      });
    } else {
      // 표시가 있던 파일이 손상되어 치워졌다면 OS 저장소에 키가 남아 있을 수 있다.
      await platformVault()?.remove().catch(() => undefined);
    }
    await removeKeyFiles(path);
    cache.entry = null;
  });
}
