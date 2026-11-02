import { mkdirSync, mkdtempSync, promises as fs, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMission, listMissionSummaries } from '@/lib/agents/mission';
import { keyStorageNote } from '@/lib/client/format';
import { runWithInput } from '@/lib/platform/exec';
import { dpapiVault, keychainVault, platformVault, secretServiceVault, setKeyVaultForTests, type KeyVault, type VaultExec } from '@/lib/platform/keystore';
import { ps } from '@/lib/platform/powershell';
import { dataDir, dataPath } from '@/lib/store/json';
import { apiKeyInfo, clearApiKey, forgetCachedKeyForTests, getApiKey, setApiKey } from '@/lib/store/secrets';
import { addTask, listTasks } from '@/lib/store/tasks';
import { deleteAllData } from '@/lib/store/transfer';

const KEY = 'sk-ant-unit-test-key-0123456789';
const secretsFile = () => dataPath('secrets.json');
const readRaw = () => fs.readFile(secretsFile(), 'utf8');

async function seedPlaintext(key = KEY) {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(secretsFile(), JSON.stringify({ anthropicApiKey: key }));
}

/** 메모리에 키를 두는 가짜 저장소. 호출 수를 세어 캐시를 확인한다. */
function memoryVault(scheme: KeyVault['scheme'] = 'keychain') {
  const state = { stored: null as string | null, saves: 0, loads: 0, removes: 0, failSave: false, failLoad: false, failRemove: false, corrupt: false };
  const vault: KeyVault = {
    scheme,
    async save(key) {
      state.saves++;
      if (state.failSave) throw new Error(`boom ${key}`);
      state.stored = state.corrupt ? `${key}-mangled` : key;
      return scheme === 'dpapi' ? { scheme, blob: Buffer.from(state.stored).toString('base64') } : { scheme };
    },
    async load() {
      state.loads++;
      if (state.failLoad || state.stored === null) throw new Error('locked');
      return state.stored;
    },
    async remove() {
      state.removes++;
      if (state.failRemove) throw new Error('locked');
      state.stored = null;
    },
  };
  return { vault, state };
}

beforeEach(async () => {
  setKeyVaultForTests(null);
  await fs.rm(dataDir(), { recursive: true, force: true });
  forgetCachedKeyForTests();
});

afterEach(() => {
  setKeyVaultForTests(null);
  vi.restoreAllMocks();
});

describe('apiKeyInfo reports how the key is stored', () => {
  it('reports a file fallback, never more of the key than the mask', async () => {
    const hint = await setApiKey(KEY);
    expect(await apiKeyInfo()).toEqual({ hasApiKey: true, source: 'stored', hint, storage: 'file' });
    expect(JSON.stringify(await apiKeyInfo())).not.toContain(KEY);
  });

  it('reports the vault when one was used, and none when empty', async () => {
    expect((await apiKeyInfo()).storage).toBe('none');
    setKeyVaultForTests(memoryVault().vault);
    const hint = await setApiKey(KEY);
    expect(await apiKeyInfo()).toEqual({ hasApiKey: true, source: 'stored', hint, storage: 'keychain' });
  });

  it('reports env when the environment key wins', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env-0000';
    try {
      expect((await apiKeyInfo()).storage).toBe('env');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('gives settings an honest sentence for every state', () => {
    expect(keyStorageNote('file')).toMatch(/암호화하지 않고/);
    expect(keyStorageNote('dpapi')).toMatch(/DPAPI/);
    expect(keyStorageNote('keychain')).toMatch(/키체인/);
    expect(keyStorageNote('secret-service')).toMatch(/Secret Service/);
    expect(keyStorageNote('unreadable')).toMatch(/풀지 못했어요/);
    expect(keyStorageNote('env')).toBeNull();
    expect(keyStorageNote('none')).toBeNull();
  });
});

describe('falling back', () => {
  it('stays on the 0600 file when the tool is missing', async () => {
    setKeyVaultForTests(null);
    await setApiKey(KEY);
    expect(JSON.parse(await readRaw())).toEqual({ anthropicApiKey: KEY });
    expect(await getApiKey()).toBe(KEY);
  });

  it('falls back when the tool fails, and keeps tool output out of the log', async () => {
    const { vault, state } = memoryVault();
    state.failSave = true;
    setKeyVaultForTests(vault);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setApiKey(KEY);
    expect((await apiKeyInfo()).storage).toBe('file');
    expect(await getApiKey()).toBe(KEY);
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });

  it('falls back when the tool lies: a value that does not read back is not trusted', async () => {
    const { vault, state } = memoryVault();
    state.corrupt = true;
    setKeyVaultForTests(vault);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setApiKey(KEY);
    expect(state.stored).toBeNull();
    expect((await apiKeyInfo()).storage).toBe('file');
    expect(await getApiKey()).toBe(KEY);
  });
});

describe('migrating a plaintext key', () => {
  it('moves it on the next read and removes the plaintext', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await seedPlaintext();
    expect(await getApiKey()).toBe(KEY);
    expect(state.stored).toBe(KEY);
    expect(await readRaw()).not.toContain(KEY);
    expect(JSON.parse(await readRaw())).toEqual({ sealedApiKey: { scheme: 'keychain' } });
    expect((await apiKeyInfo()).storage).toBe('keychain');
  });

  it('moves it on the next write too, and leaves no old plaintext', async () => {
    const { vault } = memoryVault();
    setKeyVaultForTests(vault);
    await seedPlaintext('sk-ant-old-plaintext-key-000');
    await setApiKey(KEY);
    const raw = await readRaw();
    expect(raw).not.toContain('old-plaintext');
    expect(raw).not.toContain(KEY);
  });

  it('keeps the plaintext and says so when the vault cannot take it', async () => {
    const { vault, state } = memoryVault();
    state.failSave = true;
    setKeyVaultForTests(vault);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedPlaintext();
    expect(await getApiKey()).toBe(KEY);
    expect(JSON.parse(await readRaw())).toEqual({ anthropicApiKey: KEY });
    expect((await apiKeyInfo()).storage).toBe('file');
  });

  it('finishes a migration that died between saving and rewriting', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    state.stored = KEY;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(secretsFile(), JSON.stringify({ anthropicApiKey: KEY, sealedApiKey: { scheme: 'keychain' } }));
    expect(await getApiKey()).toBe(KEY);
    expect(await readRaw()).not.toContain(KEY);
  });

  it('migrates even while an environment key is in use', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await seedPlaintext();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env-0000';
    try {
      await apiKeyInfo();
      await vi.waitFor(() => expect(state.stored).toBe(KEY));
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('memory cache', () => {
  it('does not ask the vault again once the key is decrypted, across parallel first reads', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    forgetCachedKeyForTests();
    state.loads = 0;
    const keys = await Promise.all(Array.from({ length: 8 }, () => getApiKey()));
    expect(new Set(keys)).toEqual(new Set([KEY]));
    await apiKeyInfo();
    await getApiKey();
    expect(state.loads).toBe(1);
  });

  it('is shared through globalThis, since Next can bundle this module per route', async () => {
    await setApiKey(KEY);
    const holder = (globalThis as unknown as { __illionaireKeyCache: { entry: { key: string } | null } }).__illionaireKeyCache;
    expect(holder.entry?.key).toBe(KEY);
    vi.resetModules();
    const again = await import('@/lib/store/secrets');
    await fs.rm(secretsFile(), { force: true });
    // 다시 불러온 모듈이 같은 캐시를 보고, 파일이 사라진 것을 알아챈다.
    expect(await again.getApiKey()).toBeNull();
  });

  it('is invalidated by set and clear', async () => {
    const { vault } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    expect(await getApiKey()).toBe(KEY);
    await setApiKey('sk-ant-second-key-987654321');
    expect(await getApiKey()).toBe('sk-ant-second-key-987654321');
    await clearApiKey();
    expect(await getApiKey()).toBeNull();
    expect((await apiKeyInfo()).storage).toBe('none');
  });

  it('notices another process changing the file: the web and desktop apps share it', async () => {
    await setApiKey(KEY);
    expect(await getApiKey()).toBe(KEY);
    // 수정 시각의 해상도 때문에 크기까지 달라지게 쓴다.
    await fs.writeFile(secretsFile(), JSON.stringify({ anthropicApiKey: 'sk-ant-written-by-the-other-process-1' }));
    expect(await getApiKey()).toBe('sk-ant-written-by-the-other-process-1');
  });

  it('does not let a read in flight bring back a cleared key', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    forgetCachedKeyForTests();
    const reading = getApiKey();
    const clearing = clearApiKey();
    await Promise.all([reading, clearing]);
    expect(state.stored).toBeNull();
    expect(await getApiKey()).toBeNull();
    await expect(fs.stat(secretsFile())).rejects.toThrow();
  });
});

describe('a protected key that cannot be read right now', () => {
  it('says so, keeps the copy, and recovers without a restart', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    forgetCachedKeyForTests();
    state.failLoad = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await getApiKey()).toBeNull();
    expect(await apiKeyInfo()).toEqual({ hasApiKey: false, source: 'none', hint: null, storage: 'unreadable' });
    expect(state.stored).toBe(KEY);
    expect(JSON.parse(await readRaw())).toEqual({ sealedApiKey: { scheme: 'keychain' } });

    state.failLoad = false;
    expect(await getApiKey()).toBe(KEY);
  });

  it('refuses to start a mission instead of quietly turning it into a demo', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    forgetCachedKeyForTests();
    state.failLoad = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(createMission('실제로 해 줘')).rejects.toMatchObject({ status: 503, code: 'key_unreadable' });
    expect(await listMissionSummaries()).toEqual([]);
  });

  it('reports unreadable when the folder came from another OS', async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(secretsFile(), JSON.stringify({ sealedApiKey: { scheme: 'dpapi', blob: 'AAAA' } }));
    setKeyVaultForTests(memoryVault('keychain').vault);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await apiKeyInfo()).storage).toBe('unreadable');
  });

  it('can be replaced by registering a new key', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    forgetCachedKeyForTests();
    state.failLoad = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await getApiKey()).toBeNull();
    state.failLoad = false;
    await setApiKey('sk-ant-replacement-key-000000');
    expect(await getApiKey()).toBe('sk-ant-replacement-key-000000');
  });
});

describe('clear removes the protected copy', () => {
  it('clear removes the vault entry and the file', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    await clearApiKey();
    expect(state.stored).toBeNull();
    await expect(fs.stat(secretsFile())).rejects.toThrow();
  });

  it('clear removes a DPAPI blob, which lives in the file', async () => {
    setKeyVaultForTests(memoryVault('dpapi').vault);
    await setApiKey(KEY);
    expect(JSON.parse(await readRaw()).sealedApiKey.blob).toBeTruthy();
    await clearApiKey();
    await expect(fs.stat(secretsFile())).rejects.toThrow();
  });

  it('clear also removes moved-aside copies, which can hold a plaintext key', async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(`${secretsFile()}.corrupt-123`, `{ "anthropicApiKey": "${KEY}"`);
    await fs.writeFile(`${secretsFile()}.1.2.abc.tmp`, KEY);
    await setApiKey(KEY);
    await clearApiKey();
    const left = await fs.readdir(dataDir());
    expect(left.filter((n) => n.startsWith('secrets.json'))).toEqual([]);
  });

  it('clear tries the vault even without a marker, in case the file was lost', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    state.stored = KEY;
    await clearApiKey();
    expect(state.stored).toBeNull();
  });

  it('does not claim success when the vault refuses', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    state.failRemove = true;
    await expect(clearApiKey()).rejects.toThrow(/지우지 못했어요/);
    // 표시를 남겨 두어야 다시 시도할 수 있고, 화면도 키가 없다고 거짓말하지 않는다.
    expect(JSON.parse(await readRaw())).toEqual({ sealedApiKey: { scheme: 'keychain' } });
    expect((await apiKeyInfo()).hasApiKey).toBe(true);
    state.failRemove = false;
    await clearApiKey();
    expect(state.stored).toBeNull();
  });

  it('refuses when the tool that holds the key has gone missing', async () => {
    const { vault } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    setKeyVaultForTests(null);
    await expect(clearApiKey()).rejects.toThrow(/지우지 못했어요/);
  });

});

describe('delete-all removes the protected copy', () => {
  it('removes the key too and drops the cache', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    await addTask({ text: '지울 일' });
    await deleteAllData();
    expect(state.stored).toBeNull();
    expect(await getApiKey()).toBeNull();
    expect(await listTasks()).toEqual([]);
    expect(await fs.readdir(dataDir()).catch(() => [])).toEqual([]);
  });

  it('still wipes everything else when the vault refuses, and reports it', async () => {
    const { vault, state } = memoryVault();
    setKeyVaultForTests(vault);
    await setApiKey(KEY);
    await addTask({ text: '지울 일' });
    state.failRemove = true;
    await expect(deleteAllData()).rejects.toThrow(/지우지 못했어요/);
    expect(await listTasks()).toEqual([]);
    expect(await fs.readdir(dataDir())).toEqual(['secrets.json']);
  });

  it('cannot remove an environment key, and the settings copy says so', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env-0000';
    try {
      await deleteAllData();
      expect(await getApiKey()).toBe('sk-ant-from-env-0000');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

/** 이 기기에 macOS, Linux가 없어 가짜 실행기로만 시험한다. 실제 도구의 동작은 확인하지 못했다. */
describe('macOS and Linux vaults (mocked: the real tools were not run)', () => {
  function recorder(reply: (bin: string, args: string[], input?: string) => string = () => '') {
    const calls: { bin: string; args: string[]; input?: string }[] = [];
    const exec: VaultExec = async (bin, args, input) => {
      calls.push({ bin, args, input });
      return { stdout: reply(bin, args, input) };
    };
    return { calls, exec };
  }
  const hexKey = Buffer.from(KEY).toString('hex');

  it('keychain: the secret goes through stdin as hex, never argv', async () => {
    const { calls, exec } = recorder();
    await keychainVault(exec).save(KEY);
    expect(calls[0].bin).toBe('/usr/bin/security');
    expect(calls[0].args).toEqual(['-i']);
    expect(calls[0].input).toContain(`-X ${hexKey}`);
    expect(calls[0].input).toMatch(/\n$/);
    expect(JSON.stringify(calls[0].args)).not.toContain(KEY);
    expect(JSON.stringify(calls[0].args)).not.toContain(hexKey);
    expect(calls[0].input).not.toContain(KEY);
  });

  it('keychain: quoting cannot break out, since hex has no special characters', async () => {
    const { calls, exec } = recorder();
    await keychainVault(exec).save('sk-"; delete-keychain login; "');
    expect(calls[0].input).not.toContain('delete-keychain');
  });

  it('keychain: reads with -w on stdout and trims the newline', async () => {
    const { calls, exec } = recorder(() => `${KEY}\n`);
    expect(await keychainVault(exec).load({ scheme: 'keychain' })).toBe(KEY);
    expect(calls[0].args).toContain('find-generic-password');
    expect(JSON.stringify(calls[0].args)).not.toContain(KEY);
  });

  it('keychain: treats "not found" as removed but passes on anything else', async () => {
    const missing: VaultExec = async () => {
      throw new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
    };
    await expect(keychainVault(missing).remove()).resolves.toBeUndefined();
    const locked: VaultExec = async () => {
      throw new Error('User interaction is not allowed.');
    };
    await expect(keychainVault(locked).remove()).rejects.toThrow(/interaction/);
  });

  it('secret-tool: the secret is exactly stdin, with no newline and nothing in argv', async () => {
    const { calls, exec } = recorder();
    await secretServiceVault(exec).save(KEY);
    expect(calls[0].bin).toBe('secret-tool');
    expect(calls[0].args[0]).toBe('store');
    expect(calls[0].input).toBe(KEY);
    expect(JSON.stringify(calls[0].args)).not.toContain(KEY);
  });

  it('secret-tool: looks up and clears by the same attributes', async () => {
    const { calls, exec } = recorder(() => KEY);
    const vault = secretServiceVault(exec);
    expect(await vault.load({ scheme: 'secret-service' })).toBe(KEY);
    await vault.remove();
    expect(calls.map((c) => c.args[0])).toEqual(['lookup', 'clear']);
    expect(calls[0].args.slice(1)).toEqual(calls[1].args.slice(1));
  });

  it('separates entries per data folder, so a test or dev server cannot overwrite the real key', async () => {
    const { calls, exec } = recorder();
    const saved = process.env.ILLIONAIRE_DATA_DIR;
    await keychainVault(exec).save(KEY);
    process.env.ILLIONAIRE_DATA_DIR = join(tmpdir(), 'another-data-folder');
    await keychainVault(exec).save(KEY);
    process.env.ILLIONAIRE_DATA_DIR = saved;
    const account = (input?: string) => /-a (\S+)/.exec(input ?? '')?.[1];
    expect(account(calls[0].input)).toBeTruthy();
    expect(account(calls[0].input)).not.toBe(account(calls[1].input));
  });

  it('picks the vault by platform and the file when the tool is missing', () => {
    setKeyVaultForTests(undefined);
    const savedPath = process.env.PATH;
    const dir = mkdtempSync(join(tmpdir(), 'illionaire-path-'));
    try {
      process.env.PATH = dir;
      expect(platformVault('linux')).toBeNull();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'secret-tool'), '');
      process.env.PATH = [dir, savedPath].join(delimiter);
      expect(platformVault('linux')?.scheme).toBe('secret-service');
      expect(platformVault('win32')?.scheme).toBe('dpapi');
    } finally {
      process.env.PATH = savedPath;
      rmSync(dir, { recursive: true, force: true });
      setKeyVaultForTests(null);
    }
  });
});

describe('the stdin runner, with a real child process', () => {
  it('delivers the input and returns stdout', async () => {
    const { stdout } = await runWithInput(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], 'hello 일리네어');
    expect(stdout).toBe('hello 일리네어');
  });

  it('rejects with stderr on failure, and does not crash when the child never reads', async () => {
    await expect(runWithInput(process.execPath, ['-e', 'console.error("nope"); process.exit(3)'], 'x'.repeat(1_000_000))).rejects.toThrow(/nope/);
  });

  it('rejects when the tool does not exist, which is what triggers the fallback', async () => {
    await expect(runWithInput('definitely-not-a-real-tool', [], 'x')).rejects.toBeTruthy();
  });

  it('rejects on timeout', async () => {
    await expect(runWithInput(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], '', 50)).rejects.toThrow(/초과/);
  });

  it('does not hand the key to the child through the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-must-not-inherit-0000';
    try {
      const { stdout } = await runWithInput(process.execPath, ['-p', 'String(process.env.ANTHROPIC_API_KEY)'], '');
      expect(stdout.trim()).toBe('undefined');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('DPAPI script (no PowerShell needed)', () => {
  it('passes user strings only as environment variables', async () => {
    const scripts: string[] = [];
    const vars: Record<string, string>[] = [];
    const fake = (async (script: string, v: Record<string, string> = {}) => {
      scripts.push(script);
      vars.push(v);
      return 'QUJD';
    }) as typeof ps;
    const vault = dpapiVault(fake);
    const sealed = await vault.save(KEY);
    await vault.load(sealed);
    expect(scripts.join('\n')).not.toContain(KEY);
    expect(scripts.join('\n')).not.toContain('QUJD');
    expect(scripts.join('\n')).toContain('CurrentUser');
    expect(vars[0]).toEqual({ SECRET: KEY });
    expect(vars[1]).toEqual({ SEALED: 'QUJD' });
  });
});

describe.runIf(process.platform === 'win32')('real DPAPI on this Windows machine', () => {
  const REAL_KEY = 'sk-ant-real-dpapi-test-한글-0123456789';
  const DPAPI_MS = 60_000;

  beforeEach(() => setKeyVaultForTests(undefined));

  it(
    'encrypts at rest: the file holds no key, and a fresh read decrypts it',
    async () => {
      const hint = await setApiKey(REAL_KEY);
      const raw = await readRaw();
      expect(raw).not.toContain(REAL_KEY);
      const parsed = JSON.parse(raw);
      expect(parsed.anthropicApiKey).toBeUndefined();
      expect(parsed.sealedApiKey.scheme).toBe('dpapi');
      expect(Buffer.from(parsed.sealedApiKey.blob, 'base64').toString('utf8')).not.toContain('sk-ant');
      expect(await apiKeyInfo()).toEqual({ hasApiKey: true, source: 'stored', hint, storage: 'dpapi' });

      // 새 프로세스처럼 캐시를 비우고 실제 Unprotect로 푼다.
      forgetCachedKeyForTests();
      expect(await getApiKey()).toBe(REAL_KEY);
    },
    DPAPI_MS
  );

  it(
    'migrates a real plaintext file',
    async () => {
      await seedPlaintext(REAL_KEY);
      expect(await getApiKey()).toBe(REAL_KEY);
      const raw = await readRaw();
      expect(raw).not.toContain(REAL_KEY);
      expect(JSON.parse(raw).sealedApiKey.scheme).toBe('dpapi');
      forgetCachedKeyForTests();
      expect(await getApiKey()).toBe(REAL_KEY);
    },
    DPAPI_MS
  );

  it(
    'reports a tampered blob as unreadable and leaves it in place',
    async () => {
      await setApiKey(REAL_KEY);
      const parsed = JSON.parse(await readRaw());
      const bytes = Buffer.from(parsed.sealedApiKey.blob, 'base64');
      bytes[bytes.length - 1] ^= 0xff;
      parsed.sealedApiKey.blob = bytes.toString('base64');
      await fs.writeFile(secretsFile(), JSON.stringify(parsed));
      forgetCachedKeyForTests();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await getApiKey()).toBeNull();
      expect((await apiKeyInfo()).storage).toBe('unreadable');
      expect(JSON.parse(await readRaw()).sealedApiKey.blob).toBe(parsed.sealedApiKey.blob);
    },
    DPAPI_MS
  );

  it(
    'leaves nothing behind in the process environment for later children',
    async () => {
      await setApiKey(REAL_KEY);
      expect(process.env.ILL_SECRET).toBeUndefined();
      expect(await ps('[Console]::Out.Write([string]$env:ILL_SECRET)')).toBe('');
    },
    DPAPI_MS
  );

  it(
    'clear removes the blob',
    async () => {
      await setApiKey(REAL_KEY);
      await clearApiKey();
      await expect(fs.stat(secretsFile())).rejects.toThrow();
      expect(await getApiKey()).toBeNull();
    },
    DPAPI_MS
  );
});
