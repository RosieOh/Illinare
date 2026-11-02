#!/usr/bin/env node
/**
 * 화면 캡처 도구.
 *   node scripts/shot.mjs <url> <out.png> [width] [height] [theme] [--js 코드 | --js-file 파일] [--mock mocks.json] [--wait ms] [--full]
 * theme: light | dark (OS 색상 선호로 에뮬레이션)
 * --clip x,y,w,h: 일부 영역만 캡처한다. --dpr n: 픽셀 배율(기본 2).
 * --motion: reduce 를 주면 모션 감소 상태로 캡처한다.
 * --mock: { "/api/bootstrap": {...} } 형태의 JSON. 키 끝에 *를 쓰면 접두사 일치이고, 값은 응답 본문이다.
 *         /events 로 끝나는 경로는 빈 응답으로 끊어 EventSource가 재시도하지 않게 한다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  const versions = existsSync(root) ? readdirSync(root).sort().reverse() : [];
  for (const version of versions) {
    const candidate = join(root, version, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Chrome을 찾을 수 없습니다: ${root}`);
}

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--full') flags.full = true;
  else if (arg.startsWith('--')) flags[arg.slice(2)] = argv[++i];
  else positional.push(arg);
}

const [url, out, width = '1440', height = '900', theme = 'light'] = positional;
if (!url || !out) {
  console.error('사용법: node scripts/shot.mjs <url> <out.png> [width] [height] [theme] [--js 코드] [--js-file 파일] [--mock 파일] [--wait ms] [--full]');
  process.exit(1);
}

const mocks = flags.mock ? JSON.parse(readFileSync(flags.mock, 'utf8')) : null;

function findMock(pathname) {
  if (!mocks) return undefined;
  if (pathname in mocks) return { body: mocks[pathname] };
  for (const [key, body] of Object.entries(mocks)) {
    if (key.endsWith('*') && pathname.startsWith(key.slice(0, -1))) return { body };
  }
  return undefined;
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: Number(width), height: Number(height), deviceScaleFactor: Number(flags.dpr ?? 2) });
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: theme },
    { name: 'prefers-reduced-motion', value: flags.motion ?? 'no-preference' },
  ]);

  const logs = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warn') && !m.text().includes('GPU stall')) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  if (mocks) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (!pathname.startsWith('/api/')) return req.continue();
      const hit = findMock(pathname);
      if (hit) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(hit.body) });
      if (pathname.endsWith('/events')) return req.respond({ status: 204, body: '' });
      return req.respond({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'mock', message: '모의 응답 없음' } }),
      });
    });
  }

  // 소프트웨어 렌더링에서는 load 이벤트가 한참 밀릴 수 있어 DOM 준비까지만 기다리고 --wait로 안정화한다.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  // 개발 모드 표시기는 화면 검수에 방해가 된다.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const code = flags['js-file'] ? readFileSync(flags['js-file'], 'utf8') : flags.js;
  if (code) await page.evaluate(code);
  await new Promise((resolve) => setTimeout(resolve, Number(flags.wait ?? 900)));

  mkdirSync(dirname(out), { recursive: true });
  const [cx, cy, cw, ch] = (flags.clip ?? '').split(',').map(Number);
  await page.screenshot({
    path: out,
    fullPage: Boolean(flags.full),
    ...(flags.clip ? { clip: { x: cx, y: cy, width: cw, height: ch } } : null),
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`saved ${out} (${width}x${height} ${theme}) overflowX=${overflow}`);
  if (logs.length) console.log(logs.slice(0, 12).join('\n'));
} finally {
  await browser.close();
}
