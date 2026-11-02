#!/usr/bin/env node
/**
 * next build 결과를 패키징할 수 있게 다듬는다.
 * - Next standalone 출력은 public과 .next/static을 포함하지 않으므로 옆에 복사한다.
 * - standalone은 프로젝트의 .env 파일까지 함께 복사한다. 개발자의 API 키가 설치 파일에 들어가지 않도록 필요한 항목만 남긴다.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const stage = join(root, '.next', 'desktop-stage');

function fail(message) {
  console.error(`[desktop-prepare] ${message}`);
  process.exit(1);
}

if (!existsSync(join(standalone, 'server.js'))) {
  fail(`${relative(root, standalone)}/server.js가 없어요. next.config.ts의 output: 'standalone'을 확인하고 next build를 먼저 실행하세요.`);
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });

/** 서버 실행에 필요한 항목만 남긴다. .env와 파일 추적에 딸려 온 원본 소스는 지운다. */
const KEEP = new Set(['.next', 'node_modules', 'public', 'package.json', 'server.js']);
const removed = [];
for (const name of readdirSync(standalone)) {
  if (!KEEP.has(name)) {
    rmSync(join(standalone, name), { recursive: true, force: true });
    removed.push(name);
  }
}

/** 설치 파일에 키가 섞여 들어가면 빌드를 멈춘다. 자주 쓰이는 텍스트 설정 파일만 확인한다. */
const leaks = [];
function scan(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'static' || name === 'vendor') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) scan(path);
    else if (info.size < 4_000_000 && /\.(js|json|env|txt|md|html|map)$/.test(name) && readFileSync(path, 'utf8').includes('sk-ant-api')) {
      leaks.push(relative(standalone, path));
    }
  }
}
scan(standalone);
if (leaks.length > 0) fail(`API 키로 보이는 값이 빌드에 포함됐어요: ${leaks.join(', ')}`);

// electron-builder는 extraResources 원본 바로 아래의 node_modules를 건너뛴다. 한 단계 아래에 두면 복사된다.
rmSync(stage, { recursive: true, force: true });
cpSync(standalone, join(stage, 'server'), { recursive: true });

console.log(`[desktop-prepare] 준비 완료. 제거한 항목: ${removed.length ? removed.join(', ') : '없음'}`);
