import type { Deck, DeckSlide } from '@/lib/contracts';

/** 슬라이드 설계 크기. 화면과 인쇄 모두 이 크기로 그린 뒤 배율만 바꾼다. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

type BarSlide = Extract<DeckSlide, { type: 'bars' }>;
type Bar = BarSlide['bars'][number];

/** 막대의 가로축 끝값. 기준선은 항상 0이고, 퍼센트는 100까지 보여 준다. */
export function barDomain(bars: readonly Bar[]): number {
  let max = 0;
  let percent = false;
  for (const bar of bars) {
    max = Math.max(max, bar.value, bar.target ?? 0);
    if (bar.unit === '%') percent = true;
  }
  if (percent) max = Math.max(max, 100);
  return max > 0 ? max : 1;
}

function toPercent(value: number, domain: number): number {
  return Math.min(100, Math.max(0, (value / domain) * 100));
}

export function barGeometry(bar: Bar, domain: number): { valuePct: number; targetPct: number | null } {
  return {
    valuePct: toPercent(bar.value, domain),
    targetPct: bar.target === undefined ? null : toPercent(bar.target, domain),
  };
}

export function formatBarValue(value: number, unit?: string): string {
  const number = Number.isInteger(value) ? value.toLocaleString('ko-KR') : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return unit ? `${number}${unit}` : number;
}

/** 수치 슬라이드의 열 수. 4개는 한 줄에 욱여넣지 않고 2×2로 편다. */
export function statColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  return count === 4 ? 2 : 3;
}

const STAT_GAP = 48;
const STAT_RULE_PADDING = 28;
const SLIDE_CONTENT_WIDTH = SLIDE_WIDTH - 176;

/** 글자 폭을 em으로 어림한다. 한글과 전각은 1em, 나머지는 약 0.62em. */
function estimateEm(text: string): number {
  let em = 0;
  for (const char of text) em += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.62;
  return em;
}

/** 수치가 한 줄에 들어가는 글자 크기. 모든 칸을 같은 크기로 맞춘다. */
export function statValueSize(values: readonly string[]): number {
  const columns = statColumns(values.length);
  const inner = (SLIDE_CONTENT_WIDTH - STAT_GAP * (columns - 1)) / columns - (columns > 1 ? STAT_RULE_PADDING : 0);
  const widest = Math.max(1, ...values.map(estimateEm));
  const max = columns === 1 ? 104 : columns === 2 ? 84 : 68;
  return Math.round(Math.min(max, Math.max(32, inner / widest)));
}

/** 스크린 리더와 목록에 쓰는 슬라이드 이름 */
export function slideLabel(slide: DeckSlide): string {
  return slide.type === 'quote' ? slide.quote : slide.title;
}

export function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, length - 1), Math.max(0, index));
}

export type PresenterAction = 'next' | 'prev' | 'first' | 'last' | 'exit' | 'overview' | 'notes';

interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** 입력 요소에서 눌린 키인가 */
  typing?: boolean;
}

/**
 * 발표 중의 키 해석. 입력 중인 키와 조합키는 절대 가로채지 않는다.
 * 이 함수는 발표 화면이 열려 있는 동안에만 호출된다.
 */
export function presenterAction({ key, metaKey, ctrlKey, altKey, typing }: KeyInput): PresenterAction | null {
  if (typing || metaKey || ctrlKey || altKey) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Escape':
      return 'exit';
    case 'g':
    case 'G':
    case 'ㅎ':
      return 'overview';
    case 'n':
    case 'N':
    case 'ㅜ':
      return 'notes';
    default:
      return null;
  }
}

/** 최근 자료가 앞에 오고 예시는 뒤로 간다. */
export function sortDecks(decks: readonly Deck[]): Deck[] {
  return [...decks].sort((a, b) => {
    if (!!a.sample !== !!b.sample) return a.sample ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });
}
