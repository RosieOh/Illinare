/**
 * 명령 팔레트용 퍼지 검색. 순서가 맞는 부분 문자열을 점수화하고,
 * 한글 초성 검색("ㅅㅅㅌ" → "시스템")을 지원한다.
 */
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

export function toChoseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

function subsequenceScore(query: string, target: string): number {
  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const ch of query) {
    const found = target.indexOf(ch, cursor);
    if (found === -1) return 0;
    streak = found === cursor ? streak + 1 : 0;
    // 앞쪽 일치와 연속 일치에 가점
    score += 1 + streak * 2 + (found === 0 ? 3 : 0) + 1 / (found + 1);
    cursor = found + ch.length;
  }
  return score;
}

/** 0이면 불일치. 값이 클수록 잘 맞는다. */
export function fuzzyScore(query: string, ...targets: string[]): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return 1;
  let best = 0;
  for (const raw of targets) {
    const t = raw.toLowerCase().replace(/\s+/g, '');
    if (t.includes(q)) best = Math.max(best, 100 - t.indexOf(q) + q.length);
    best = Math.max(best, subsequenceScore(q, t), subsequenceScore(q, toChoseong(t)) * 0.9);
  }
  return best;
}
