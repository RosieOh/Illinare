#!/usr/bin/env node
/** 개발용: next dev를 띄우고 그 주소를 Electron 창으로 연다. 창을 닫으면 서버도 끝난다. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const PORT = process.env.PORT ?? '3000';
const url = `http://127.0.0.1:${PORT}`;
const require = createRequire(import.meta.url);

const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', PORT], {
  stdio: 'inherit',
  env: { ...process.env, ILLIONAIRE_DESKTOP: '1' },
});

async function waitForServer() {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* 아직 뜨는 중 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url}에 연결하지 못했어요.`);
}

try {
  await waitForServer();
  // VS Code 터미널은 ELECTRON_RUN_AS_NODE를 물려준다. 남아 있으면 Electron이 일반 Node로 뜬다.
  const env = { ...process.env, ILLIONAIRE_DEV_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = spawn(require('electron'), ['.'], {
    stdio: 'inherit',
    env,
  });
  electron.once('exit', (code) => {
    next.kill();
    process.exit(code ?? 0);
  });
} catch (err) {
  console.error(err.message);
  next.kill();
  process.exit(1);
}
