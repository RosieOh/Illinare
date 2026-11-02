import { join } from 'node:path';
import { firstLine, run } from './exec';

/**
 * PowerShell 실행 헬퍼.
 * - 사용자 문자열은 절대 스크립트에 끼워 넣지 않고 환경 변수($env:ILL_*)로만 전달한다.
 * - 출력은 UTF-8로 강제한다 (한국어 앱 이름, 경로).
 * - 환경 변수 하나의 한도는 약 32,000자이다. 호출자가 입력 길이를 제한해야 한다.
 */
const PRELUDE = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)',
  '',
].join(';');

const ERROR_MARK = 'ILLERR:';

/** 표준 오류에서 사람이 읽을 메시지를 꺼낸다. */
function readableError(raw: string): string {
  const marked = raw.split('\n').find((line) => line.includes(ERROR_MARK));
  if (marked) return firstLine(marked.slice(marked.indexOf(ERROR_MARK) + ERROR_MARK.length));
  if (raw.includes('CLIXML')) return 'PowerShell 명령을 실행하지 못했습니다';
  return firstLine(raw);
}

function powershellPath(): string {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export async function ps(
  script: string,
  vars: Record<string, string> = {},
  opts: { timeoutMs?: number; maxBufferKb?: number } = {}
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(vars)) env[`ILL_${key}`] = value;
  // -EncodedCommand로 실행하면 표준 오류가 CLIXML로 나오므로 오류를 직접 잡아 평문으로 쓴다.
  const wrapped = [
    `${PRELUDE}try {`,
    script,
    `} catch { [Console]::Error.WriteLine('${ERROR_MARK}' + $_.Exception.Message); exit 1 }`,
  ].join('\n');
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  try {
    const { stdout } = await run(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-OutputFormat',
        'Text',
        '-EncodedCommand',
        encoded,
      ],
      { env, timeoutMs: opts.timeoutMs ?? 15000, maxBufferKb: opts.maxBufferKb ?? 2048 }
    );
    return stdout.trim();
  } catch (err) {
    throw new Error(readableError(err instanceof Error ? err.message : String(err)));
  }
}
