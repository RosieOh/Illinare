#!/usr/bin/env node
/**
 * 임시 앱 아이콘 생성기. 브랜드 표식 SVG를 헤드리스 Chrome으로 PNG로 굽는다.
 * 출시 전에 디자이너가 만든 아이콘으로 교체해야 한다.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const MARK = 'M19.8 16.18C19.79 12.68 20.7 11.95 22.42 11.62A4.3 4.3 0 1 0 17.57 5.9C16.96 7.54 16.1 8.31 12.64 7.72A8.6 8.6 0 1 0 19.8 16.18Z';
const out = join(process.cwd(), 'electron', 'assets');
mkdirSync(out, { recursive: true });

function findChrome() {
  const base = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const version of readdirSync(base).sort().reverse()) {
    const candidate = join(base, version, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Chrome을 찾을 수 없어요: ${base}`);
}

const appIcon = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a9bff"/><stop offset="1" stop-color="#0a4fd6"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)"/>
  <rect x="68" y="68" width="888" height="888" rx="204" fill="none" stroke="url(#edge)" stroke-width="8"/>
  <g transform="translate(176 176) scale(24)"><path d="${MARK}" fill="#ffffff"/></g>
</svg>`;

const mark = (size, color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28"><path d="${MARK}" fill="${color}"/></svg>`;

const targets = [
  { file: 'icon.png', size: 1024, svg: appIcon },
  { file: 'tray.png', size: 32, svg: mark(32, '#3a9bff') },
  { file: 'trayTemplate.png', size: 22, svg: mark(22, '#000000') },
  { file: 'trayTemplate@2x.png', size: 44, svg: mark(44, '#000000') },
];

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  for (const { file, size, svg } of targets) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>*{margin:0}body{background:transparent}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: join(out, file), omitBackground: true });
    console.log(`${file} (${size}px)`);
  }

  // 파비콘. ICO 안에 PNG를 그대로 담는다.
  await page.setViewport({ width: 64, height: 64, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>*{margin:0}body{background:transparent}svg{display:block;width:64px;height:64px}</style>${appIcon}`);
  const png = Buffer.from(await page.screenshot({ omitBackground: true }));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 64;
  entry[1] = 64;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  writeFileSync(join(process.cwd(), 'app', 'favicon.ico'), Buffer.concat([dir, entry, png]));
  console.log('app/favicon.ico (64px)');
} finally {
  await browser.close();
}
