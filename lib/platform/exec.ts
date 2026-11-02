import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * 안전한 프로세스 실행.
 * - 인자 배열만 허용하고 shell은 쓰지 않는다.
 * - 출력은 기본 1MB, 시간은 기본 5초로 제한한다.
 */
export interface RunOptions {
  timeoutMs?: number;
  maxBufferKb?: number;
  env?: NodeJS.ProcessEnv;
}

/** 자식 프로세스(앱 실행 포함)에 물려주지 않는 값 */
const SECRET_ENV = new Set(['ILLIONAIRE_SESSION_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);

/** 비밀 값을 뺀 환경 변수. Windows는 이름의 대소문자를 구분하지 않으므로 대문자로 비교한다. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(base)) {
    if (!SECRET_ENV.has(key.toUpperCase())) env[key] = value;
  }
  return env;
}

export function run(
  bin: string,
  args: string[],
  opts: RunOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: opts.timeoutMs ?? 5000,
        maxBuffer: (opts.maxBufferKb ?? 1024) * 1024,
        encoding: 'utf8',
        windowsHide: true,
        env: childEnv(opts.env),
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || '').trim();
          const timedOut = 'killed' in err && err.killed;
          reject(new Error(timedOut ? `${bin} 실행 시간이 초과되었습니다` : detail || err.message));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/** 표준 입력으로 텍스트를 넘겨야 하는 명령 (pbcopy, wl-copy 등) */
export function runWithStdin(bin: string, args: string[], input: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: childEnv() });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${bin} 실행 시간이 초과되었습니다`));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    // xclip과 wl-copy는 클립보드를 내주려고 백그라운드에 남아 파이프를 쥐고 있어 close가 오지 않는다. 성공은 exit로 판단한다.
    child.on('exit', (code) => {
      if (code !== 0) return;
      clearTimeout(timer);
      child.stderr.destroy();
      resolve();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${bin} 종료 코드 ${code}`));
    });
    // 자식이 입력을 다 읽기 전에 끝나면 EPIPE가 난다. 처리기가 없으면 서버 전체가 죽는다. 결과는 close에서 판단한다.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/** 표준 입력을 넘기고 표준 출력을 받아야 하는 명령. 비밀 값은 인자 대신 여기로 넘긴다. */
export function runWithInput(bin: string, args: string[], input: string, timeoutMs = 5000): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${bin} 실행 시간이 초과되었습니다`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout });
      else reject(new Error(stderr.trim() || `${bin} 종료 코드 ${code}`));
    });
    // 자식이 입력을 읽기 전에 끝나면 EPIPE가 난다. 처리하지 않으면 서버가 죽는다. 결과는 close에서 판단한다.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/** PATH에서 실행 파일을 동기적으로 찾는다. available() 판단용. */
export function onPath(bin: string): boolean {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(join(dir, bin)));
}

/** 오류 출력에서 사람이 읽을 첫 줄만 남긴다. */
export function firstLine(message: string): string {
  const line = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return (line ?? message).slice(0, 300);
}
