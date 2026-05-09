import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Safe shell exec.
 * - 인자 배열만 허용 — shell:true 사용 금지
 * - 출력은 1MB 제한, 5초 타임아웃
 */
export async function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxBufferKb?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileP(bin, args, {
    timeout: opts.timeoutMs ?? 5000,
    maxBuffer: (opts.maxBufferKb ?? 1024) * 1024,
    encoding: 'utf8',
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** AppleScript 한 조각 실행 — 인자는 escape 처리됨 */
export async function osa(
  script: string,
  ...replacements: string[]
): Promise<string> {
  let i = 0;
  const filled = script.replace(/\$\$/g, () => escapeOsaString(replacements[i++] ?? ''));
  const { stdout } = await run('/usr/bin/osascript', ['-e', filled], { timeoutMs: 8000 });
  return stdout.trim();
}

/** AppleScript 문자열 안에 안전하게 들어가도록 이스케이프 */
function escapeOsaString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 결과를 사람 읽기 좋게 한 줄로 */
export function ok(message: string): string {
  return `OK: ${message}`;
}
export function fail(message: string): string {
  return `ERROR: ${message}`;
}
