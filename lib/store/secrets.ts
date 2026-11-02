import { dataPath, readJson, updateJson } from './json';

/**
 * API 키 저장. 환경 변수 ANTHROPIC_API_KEY가 있으면 그것이 우선이다.
 * 저장 파일은 mode 0600으로 쓴다. Windows에서는 mode가 적용되지 않으며 %APPDATA%의 사용자 ACL에 의존한다.
 */
interface SecretsFile {
  anthropicApiKey?: string;
}

const file = () => dataPath('secrets.json');

function envKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

export async function getApiKey(): Promise<string | null> {
  const env = envKey();
  if (env) return env;
  const saved = await readJson<SecretsFile>(file(), {});
  return saved.anthropicApiKey ?? null;
}

function maskKey(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export async function apiKeyInfo(): Promise<{
  hasApiKey: boolean;
  source: 'env' | 'stored' | 'none';
  hint: string | null;
}> {
  const env = envKey();
  if (env) return { hasApiKey: true, source: 'env', hint: maskKey(env) };
  const saved = await readJson<SecretsFile>(file(), {});
  if (saved.anthropicApiKey) {
    return { hasApiKey: true, source: 'stored', hint: maskKey(saved.anthropicApiKey) };
  }
  return { hasApiKey: false, source: 'none', hint: null };
}

export async function setApiKey(key: string): Promise<string> {
  await updateJson<SecretsFile>(file(), {}, (current) => ({ ...current, anthropicApiKey: key }));
  return maskKey(key);
}

export async function clearApiKey(): Promise<void> {
  await updateJson<SecretsFile>(file(), {}, (current) => {
    const next = { ...current };
    delete next.anthropicApiKey;
    return next;
  });
}
