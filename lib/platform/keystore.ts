import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dataDir } from '@/lib/store/json';
import { onPath, runWithInput } from './exec';
import { ps } from './powershell';

/**
 * API 키를 OS의 보호 저장소에 넣는다.
 * - 비밀 값은 프로세스 인자로 넘기지 않는다. 인자는 같은 기기의 다른 프로세스에게 보인다.
 * - PowerShell에는 환경 변수로, security와 secret-tool에는 표준 입력으로 넘긴다.
 * - 모두 같은 사용자로 도는 프로그램은 막지 못한다. SECURITY.md를 보라.
 */
export type VaultScheme = 'dpapi' | 'keychain' | 'secret-service';

/** secrets.json에 남기는 내용. dpapi는 암호문이고, 나머지는 OS 저장소에 있다는 표시뿐이다. */
export interface SealedKey {
  scheme: VaultScheme;
  blob?: string;
}

export interface KeyVault {
  scheme: VaultScheme;
  save(key: string): Promise<SealedKey>;
  /** 없거나 풀 수 없으면 throw 한다. */
  load(sealed: SealedKey): Promise<string>;
  remove(): Promise<void>;
}

export type VaultExec = (bin: string, args: string[], input?: string) => Promise<{ stdout: string }>;

const EXEC_TIMEOUT_MS = 10_000;
const defaultExec: VaultExec = (bin, args, input = '') => runWithInput(bin, args, input, EXEC_TIMEOUT_MS);

const SERVICE = 'Illionaire';

/** 데이터 폴더마다 항목을 나눈다. 테스트나 개발 서버가 실제로 쓰는 키를 덮어쓰면 안 된다. */
function account(): string {
  return `anthropic-api-key-${createHash('sha256').update(dataDir()).digest('hex').slice(0, 16)}`;
}

// ─── Windows: DPAPI (CurrentUser) ────────────────────────────
const LOAD_DPAPI = 'Add-Type -AssemblyName System.Security';
const SCOPE = '[Security.Cryptography.DataProtectionScope]::CurrentUser';

export function dpapiVault(runPs: typeof ps = ps): KeyVault {
  return {
    scheme: 'dpapi',
    async save(key) {
      const blob = await runPs(
        [
          LOAD_DPAPI,
          '$plain = [Text.Encoding]::UTF8.GetBytes($env:ILL_SECRET)',
          `$sealed = [Security.Cryptography.ProtectedData]::Protect($plain, $null, ${SCOPE})`,
          '[Console]::Out.Write([Convert]::ToBase64String($sealed))',
        ].join('\n'),
        { SECRET: key }
      );
      return { scheme: 'dpapi', blob };
    },
    async load(sealed) {
      // 출력 인코딩에 흔들리지 않도록 base64로 받는다.
      const plain = await runPs(
        [
          LOAD_DPAPI,
          '$sealed = [Convert]::FromBase64String($env:ILL_SEALED)',
          `$plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, ${SCOPE})`,
          '[Console]::Out.Write([Convert]::ToBase64String($plain))',
        ].join('\n'),
        { SEALED: sealed.blob ?? '' }
      );
      return Buffer.from(plain, 'base64').toString('utf8');
    },
    // 암호문은 secrets.json 안에 있어 파일을 고치면 함께 사라진다.
    async remove() {},
  };
}

// ─── macOS: Keychain ─────────────────────────────────────────
const SECURITY_BIN = '/usr/bin/security';

export function keychainVault(exec: VaultExec = defaultExec): KeyVault {
  return {
    scheme: 'keychain',
    async save(key) {
      // -w 뒤에 값을 주면 인자로 보인다. -i는 명령을 표준 입력에서 읽고, -X는 16진수라 따옴표 문제가 없다.
      const hex = Buffer.from(key, 'utf8').toString('hex');
      await exec(SECURITY_BIN, ['-i'], `add-generic-password -U -a ${account()} -s ${SERVICE} -X ${hex}\n`);
      return { scheme: 'keychain' };
    },
    async load() {
      const { stdout } = await exec(SECURITY_BIN, ['find-generic-password', '-a', account(), '-s', SERVICE, '-w']);
      return stdout.trim();
    },
    async remove() {
      try {
        await exec(SECURITY_BIN, ['delete-generic-password', '-a', account(), '-s', SERVICE]);
      } catch (err) {
        // 이미 없는 것은 지우려던 상태와 같다. 잠긴 키체인 같은 다른 실패는 올려 보낸다.
        if (!/could not be found/i.test(err instanceof Error ? err.message : '')) throw err;
      }
    },
  };
}

// ─── Linux: Secret Service (libsecret) ───────────────────────
const SECRET_TOOL = 'secret-tool';

export function secretServiceVault(exec: VaultExec = defaultExec): KeyVault {
  const attributes = () => ['application', SERVICE, 'account', account()];
  return {
    scheme: 'secret-service',
    async save(key) {
      // 터미널이 아니면 표준 입력을 끝까지 비밀 값으로 읽는다. 줄바꿈을 붙이면 값의 일부가 된다.
      await exec(SECRET_TOOL, ['store', `--label=${SERVICE} API key`, ...attributes()], key);
      return { scheme: 'secret-service' };
    },
    async load() {
      const { stdout } = await exec(SECRET_TOOL, ['lookup', ...attributes()]);
      return stdout.trim();
    },
    async remove() {
      await exec(SECRET_TOOL, ['clear', ...attributes()]);
    },
  };
}

// ─── 선택 ────────────────────────────────────────────────────
/** 테스트가 실제 OS 저장소를 건드리지 않도록 tests/setup.ts가 null로 둔다. undefined면 실제 저장소를 쓴다. */
const holder = globalThis as unknown as { __illionaireKeyVault?: KeyVault | null };

export function setKeyVaultForTests(vault: KeyVault | null | undefined) {
  holder.__illionaireKeyVault = vault;
}

/** 이 OS의 보호 저장소. 도구가 없으면 null이고 호출자는 0600 파일로 물러난다. */
export function platformVault(platform: NodeJS.Platform = process.platform): KeyVault | null {
  if (holder.__illionaireKeyVault !== undefined) return holder.__illionaireKeyVault;
  if (platform === 'win32') return dpapiVault();
  if (platform === 'darwin') return existsSync(SECURITY_BIN) ? keychainVault() : null;
  return onPath(SECRET_TOOL) ? secretServiceVault() : null;
}
