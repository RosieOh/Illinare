#!/usr/bin/env node
/**
 * 손 인식 모델을 public/vendor로 복사한다. 앱은 CDN을 쓰지 않으므로 런타임에 외부 연결이 없다.
 * modelComplexity 0만 쓰므로 hand_landmark_full.tflite는 복사하지 않는다.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'hands');
const to = join(root, 'public', 'vendor', 'mediapipe', 'hands');

const FILES = [
  'hands.js',
  'hands.binarypb',
  'hand_landmark_lite.tflite',
  'hands_solution_packed_assets.data',
  'hands_solution_packed_assets_loader.js',
  'hands_solution_simd_wasm_bin.js',
  'hands_solution_simd_wasm_bin.wasm',
  'hands_solution_wasm_bin.js',
  'hands_solution_wasm_bin.wasm',
];

if (!existsSync(from)) {
  console.warn('[copy-vendor] @mediapipe/hands가 설치되어 있지 않아 건너뜁니다.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });
let copied = 0;
for (const file of FILES) {
  const source = join(from, file);
  const target = join(to, file);
  if (!existsSync(source)) throw new Error(`[copy-vendor] 파일이 없습니다: ${source}`);
  if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
  copyFileSync(source, target);
  copied++;
}
if (copied) console.log(`[copy-vendor] 손 인식 모델 파일 ${copied}개를 복사했습니다.`);
