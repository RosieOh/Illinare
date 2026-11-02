import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { screen } from 'electron';

const DEFAULT_WIDTH = 1320;
const DEFAULT_HEIGHT = 880;
export const MIN_WIDTH = 960;
export const MIN_HEIGHT = 640;

export function loadState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

/** 저장된 위치가 지금 연결된 화면에 충분히 보일 때만 쓴다. 분리된 모니터로 창이 사라지지 않게 한다. */
export function resolveBounds(saved) {
  const { workArea } = screen.getPrimaryDisplay();
  const fallback = {
    width: Math.min(DEFAULT_WIDTH, workArea.width),
    height: Math.min(DEFAULT_HEIGHT, workArea.height),
  };
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return fallback;

  const width = Math.max(saved.width, MIN_WIDTH);
  const height = Math.max(saved.height, MIN_HEIGHT);
  const visible = screen.getAllDisplays().some(({ workArea: area }) => {
    const overlapX = Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapY = Math.min(saved.y + height, area.y + area.height) - Math.max(saved.y, area.y);
    return overlapX >= 160 && overlapY >= 80;
  });
  return visible ? { x: saved.x, y: saved.y, width, height } : fallback;
}
