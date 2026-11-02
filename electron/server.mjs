import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { utilityProcess } from 'electron';

const READY_TIMEOUT_MS = 30_000;

/** 지정한 포트가 비어 있으면 그대로 쓰고, 아니면 운영체제가 고른 빈 포트를 쓴다. */
export async function pickPort(preferred) {
  if (preferred && (await canBind(preferred))) return preferred;
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

function requestOk(port) {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/**
 * Next standalone 서버를 유틸리티 프로세스로 띄운다.
 * 서버는 루프백에만 바인드되고, 로그는 사용자 데이터 폴더에 남긴다.
 */
export function startServer({ entry, port, token, secrets, dataDir, logFile, onUnexpectedExit }) {
  mkdirSync(dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: 'w' });
  let tail = '';
  const record = (chunk) => {
    log.write(chunk);
    tail = (tail + chunk.toString('utf8')).slice(-2000);
  };

  const child = utilityProcess.fork(entry, [], {
    serviceName: 'Illionaire Server',
    cwd: dirname(entry),
    stdio: 'pipe',
    env: {
      ...process.env,
      ...secrets,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      ILLIONAIRE_SESSION_TOKEN: token,
      ILLIONAIRE_DESKTOP: '1',
      ILLIONAIRE_DATA_DIR: dataDir,
    },
  });
  child.stdout?.on('data', record);
  child.stderr?.on('data', record);

  let stopping = false;
  let exited = false;
  child.once('exit', (code) => {
    exited = true;
    record(`\n[server exited: ${code}]\n`);
    log.end();
    if (!stopping) onUnexpectedExit?.(code);
  });

  return {
    /** 응답을 시작하면 끝난다. 시간 안에 안 되거나 먼저 죽으면 throw 한다. */
    async waitReady() {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (exited) throw new Error('서버 프로세스가 시작 중에 종료되었어요.');
        if (await requestOk(port)) return;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`서버가 ${READY_TIMEOUT_MS / 1000}초 안에 응답하지 않았어요.`);
    },
    stop() {
      stopping = true;
      if (!exited) child.kill();
    },
    logTail: () => tail,
  };
}

export function serverEntry(appRoot, packaged) {
  return packaged ? join(process.resourcesPath, 'server', 'server.js') : join(appRoot, '.next', 'standalone', 'server.js');
}
