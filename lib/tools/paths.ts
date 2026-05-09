import { homedir } from 'node:os';
import { resolve, normalize } from 'node:path';

const HOME = homedir();

/** 차단 디렉터리 — 키 자료/설정 류는 손대지 않음 */
const BLOCKED_PREFIXES = [
  '/.ssh',
  '/.aws',
  '/.config/gh',
  '/.gnupg',
  '/Library/Keychains',
];

/**
 * 사용자가 입력한 경로를 정규화하고, 사용자 홈 밖이면 거부.
 * - ~ 확장
 * - .. resolve
 * - 차단 디렉터리 검사
 */
export function safePath(input: string): string {
  if (!input) throw new Error('경로가 비어 있습니다');
  const expanded = input.startsWith('~') ? input.replace(/^~/, HOME) : input;
  const abs = resolve(normalize(expanded));
  if (!abs.startsWith(HOME + '/') && abs !== HOME) {
    throw new Error(`사용자 홈(${HOME}) 밖의 경로는 접근할 수 없습니다: ${abs}`);
  }
  for (const blocked of BLOCKED_PREFIXES) {
    if (abs.startsWith(HOME + blocked)) {
      throw new Error(`보호된 경로입니다: ${abs}`);
    }
  }
  return abs;
}

export const HOME_DIR = HOME;
