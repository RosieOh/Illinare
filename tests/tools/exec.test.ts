import { vi, afterEach, describe, expect, it } from 'vitest';

// 실제 PowerShell을 띄우는 테스트라 전체 테스트와 함께 돌면 느려진다.
vi.setConfig({ testTimeout: 60000 });
import { childEnv, run, runWithStdin } from '@/lib/platform/exec';
import { ps } from '@/lib/platform/powershell';
import { FIND_START_APP } from '@/lib/platform/win32';

const SECRET_KEYS = ['ILLIONAIRE_SESSION_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

describe('표준 입력을 받는 명령', () => {
  // xclip처럼 스스로 백그라운드에 남아 stderr를 쥐고 있어도 성공으로 끝나야 한다.
  it('자식이 파이프를 쥔 손자를 남기고 끝나도 기다리지 않는다', async () => {
    const script =
      "const { spawn } = require('node:child_process');" +
      "process.stdin.resume();process.stdin.on('end',()=>{" +
      "spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:['ignore','ignore','inherit'],detached:true}).unref();" +
      'process.exit(0)});';
    const started = Date.now();
    await runWithStdin(process.execPath, ['-e', script], '일리네어', 5000);
    expect(Date.now() - started).toBeLessThan(4500);
  });

  it('실패는 stderr와 함께 알린다', async () => {
    const script = "process.stdin.resume();process.stdin.on('end',()=>{console.error('도구 오류');process.exit(3)});";
    await expect(runWithStdin(process.execPath, ['-e', script], 'x', 5000)).rejects.toThrow('도구 오류');
  });
});

describe('자식 프로세스 환경', () => {
  afterEach(() => {
    for (const key of SECRET_KEYS) delete process.env[key];
  });

  it('childEnv는 비밀 값을 뺀다. 대소문자가 달라도 뺀다', () => {
    const env = childEnv({ PATH: 'p', ANTHROPIC_API_KEY: 'x', anthropic_api_key: 'y', Illionaire_Session_Token: 'z' } as unknown as NodeJS.ProcessEnv);
    expect(env).toEqual({ PATH: 'p' });
  });

  it('재현 경로: 실행한 프로세스가 세션 토큰과 API 키를 받지 못한다', async () => {
    process.env.ILLIONAIRE_SESSION_TOKEN = 'SESSION-SECRET';
    process.env.ANTHROPIC_API_KEY = 'API-SECRET';
    const script = `process.stdout.write(JSON.stringify([process.env.ILLIONAIRE_SESSION_TOKEN ?? null, process.env.ANTHROPIC_API_KEY ?? null, process.env.PATH ? 'has-path' : null]))`;
    const { stdout } = await run(process.execPath, ['-e', script], { timeoutMs: 20000 });
    expect(JSON.parse(stdout)).toEqual([null, null, 'has-path']);
  }, 30000);

  it('명시한 env를 넘겨도 비밀 값은 빠진다', async () => {
    const script = `process.stdout.write(String(process.env.ANTHROPIC_API_KEY ?? 'none') + '/' + process.env.KEEP_ME)`;
    const { stdout } = await run(process.execPath, ['-e', script], {
      timeoutMs: 20000,
      env: { ...process.env, ANTHROPIC_API_KEY: 'API-SECRET', KEEP_ME: 'yes' },
    });
    expect(stdout).toBe('none/yes');
  }, 30000);

  it.runIf(process.platform === 'win32')('PowerShell 자식도 비밀 값을 받지 못한다', async () => {
    process.env.ILLIONAIRE_SESSION_TOKEN = 'SESSION-SECRET';
    process.env.ANTHROPIC_API_KEY = 'API-SECRET';
    const out = await ps(`"[$env:ILLIONAIRE_SESSION_TOKEN][$env:ANTHROPIC_API_KEY][$env:ILL_X]"`, { X: 'kept' });
    expect(out).toBe('[][][kept]');
  }, 60000);
});

// 앱을 실행하지 않는다. 조회 부분만 돌린다.
describe.runIf(process.platform === 'win32')('시작 메뉴 조회', () => {
  it('등록되지 않은 이름은 찾지 못한다고 말한다', async () => {
    await expect(ps(`${FIND_START_APP}\n$app.AppID`, { NAME: 'illionaire-no-such-app-xyz' })).rejects.toThrow(/시작 메뉴에서 찾을 수 없는 앱/);
  }, 60000);

  it('경로와 스크립트 이름은 실행 대상이 되지 않는다', async () => {
    await expect(ps(`${FIND_START_APP}\n$app.AppID`, { NAME: 'cmd.exe /c calc' })).rejects.toThrow(/찾을 수 없는 앱/);
  }, 60000);
});
