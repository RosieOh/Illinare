/**
 * 날짜 헬퍼와 한국어 기한 파서. 전부 순수 함수이고 사용자의 현지 시간대 기준이다.
 * 날짜는 항상 YYYY-MM-DD 문자열로 주고받는다 (UTC로 해석하면 하루가 밀린다).
 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD를 현지 자정 Date로 바꾼다. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** 달을 옮긴다. 다음 달에 같은 날이 없으면 그 달의 마지막 날로 맞춘다. */
export function addMonths(iso: string, months: number): string {
  const d = fromIso(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toIso(d);
}

/** 날짜 차이 (b - a, 일 단위). 서머타임이 있어도 하루 단위로 맞도록 반올림한다. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000);
}

/** 그 주의 월요일 */
export function startOfWeek(iso: string): string {
  const day = fromIso(iso).getDay();
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

export function weekOf(iso: string): string[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[fromIso(iso).getDay()];
}

/** 11월 2일 월요일 */
export function longDate(iso: string): string {
  const d = fromIso(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}

/** 11월 2일 (월) */
export function shortDate(iso: string): string {
  const d = fromIso(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function monthLabel(iso: string): string {
  const d = fromIso(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export interface DueLabel {
  text: string;
  tone: 'overdue' | 'today' | 'soon' | 'later';
}

/** 기한을 지금 기준의 말로 바꾼다. */
export function dueLabel(due: string, today: string): DueLabel {
  const diff = daysBetween(today, due);
  if (diff < -1) return { text: `${-diff}일 지남`, tone: 'overdue' };
  if (diff === -1) return { text: '어제까지', tone: 'overdue' };
  if (diff === 0) return { text: '오늘', tone: 'today' };
  if (diff === 1) return { text: '내일', tone: 'soon' };
  if (diff === 2) return { text: '모레', tone: 'soon' };
  if (diff < 7) return { text: `${weekdayShort(due)}요일`, tone: 'soon' };
  const d = fromIso(due);
  const sameYear = d.getFullYear() === fromIso(today).getFullYear();
  return { text: `${sameYear ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일`, tone: 'later' };
}

// ─── 한국어 기한 파서 ─────────────────────────────────────────
export interface ParsedDue {
  /** 기한 표현을 뺀 나머지 */
  text: string;
  due?: string;
  /** 입력에서 찾은 표현 (화면에 보여줘서 잘못 읽었으면 지우게 한다) */
  matched?: string;
}

/** 표현 뒤에 올 수 있는 말. "오늘의 회고"처럼 다른 말의 일부면 기한으로 읽지 않는다. */
const AFTER = '(?:까지는|까지|에는|에|안에|중으로|중에|중)?(?=$|[\\s,.!?)\\]])';
const BEFORE = '(?<=^|[\\s,(\\[])';

interface Rule {
  re: RegExp;
  resolve: (m: RegExpMatchArray, today: string) => string | null;
}

/** 월·일이 실제로 있는 날짜일 때만 ISO로 만든다. 지나간 날짜면 내년으로 읽는다. */
function monthDay(month: number, day: number, today: string, year?: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const base = fromIso(today).getFullYear();
  const y = year ?? base;
  if (day > new Date(y, month, 0).getDate()) return null;
  const iso = `${y}-${pad(month)}-${pad(day)}`;
  if (year === undefined && iso < today) {
    const nextYear = y + 1;
    if (day > new Date(nextYear, month, 0).getDate()) return null;
    return `${nextYear}-${pad(month)}-${pad(day)}`;
  }
  return iso;
}

function weekdayIndex(word: string): number {
  return ['일', '월', '화', '수', '목', '금', '토'].indexOf(word);
}

/** 이번 주/다음 주의 해당 요일. 주는 월요일에 시작한다. */
function weekdayOfWeek(today: string, weekday: number, weeksAhead: number): string {
  const monday = startOfWeek(today);
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(monday, offset + weeksAhead * 7);
}

/** 요일만 말하면 오늘 다음에 오는 그 요일. 오늘이 그 요일이면 "오늘"이라 하지 않았으니 다음 주로 본다. */
function nextWeekday(today: string, weekday: number): string {
  const current = fromIso(today).getDay();
  const ahead = (weekday - current + 7) % 7 || 7;
  return addDays(today, ahead);
}

const WEEKDAY_WORD = '([월화수목금토일])(?:요일|욜)';

const RULES: Rule[] = [
  {
    re: new RegExp(`${BEFORE}(내일\\s?모레|모레|글피)${AFTER}`, 'gu'),
    resolve: (m, today) => addDays(today, m[1] === '글피' ? 3 : 2),
  },
  { re: new RegExp(`${BEFORE}오늘${AFTER}`, 'gu'), resolve: (_m, today) => today },
  { re: new RegExp(`${BEFORE}내일${AFTER}`, 'gu'), resolve: (_m, today) => addDays(today, 1) },
  {
    re: new RegExp(`${BEFORE}(이번|다음|담)\\s?주\\s?${WEEKDAY_WORD}${AFTER}`, 'gu'),
    resolve: (m, today) => weekdayOfWeek(today, weekdayIndex(m[2]), m[1] === '이번' ? 0 : 1),
  },
  {
    re: new RegExp(`${BEFORE}${WEEKDAY_WORD}${AFTER}`, 'gu'),
    resolve: (m, today) => nextWeekday(today, weekdayIndex(m[1])),
  },
  {
    re: new RegExp(`${BEFORE}(\\d{1,2}|일주)일\\s?(?:뒤|후)${AFTER}`, 'gu'),
    resolve: (m, today) => addDays(today, m[1] === '일주' ? 7 : Number(m[1])),
  },
  {
    re: new RegExp(`${BEFORE}(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})${AFTER}`, 'gu'),
    resolve: (m, today) => monthDay(Number(m[2]), Number(m[3]), today, Number(m[1])),
  },
  {
    re: new RegExp(`${BEFORE}(\\d{1,2})월\\s?(\\d{1,2})일${AFTER}`, 'gu'),
    resolve: (m, today) => monthDay(Number(m[1]), Number(m[2]), today),
  },
  {
    re: new RegExp(`${BEFORE}(\\d{1,2})[/.](\\d{1,2})${AFTER}`, 'gu'),
    resolve: (m, today) => monthDay(Number(m[1]), Number(m[2]), today),
  },
  {
    // 날짜만 말한 경우: "3일 동안"과 헷갈리지 않도록 까지/에가 붙을 때만 읽는다.
    re: new RegExp(`${BEFORE}(\\d{1,2})일(?:까지는|까지|에는|에)(?=$|[\\s,.!?)\\]])`, 'gu'),
    resolve: (m, today) => {
      const t = fromIso(today);
      const day = Number(m[1]);
      const thisMonth = monthDay(t.getMonth() + 1, day, today, t.getFullYear());
      if (thisMonth && thisMonth >= today) return thisMonth;
      const next = new Date(t.getFullYear(), t.getMonth() + 1, 1);
      return monthDay(next.getMonth() + 1, day, today, next.getFullYear());
    },
  },
];

/** 할 일 입력에서 기한 표현을 찾아 분리한다. "까지"가 붙은 표현을 먼저 보고, 없으면 가장 앞에 나온 표현 하나만 쓴다. */
export function parseKoreanDue(input: string, today: string): ParsedDue {
  let best: { index: number; length: number; due: string; explicit: boolean } | null = null;
  for (const rule of RULES) {
    for (const match of input.matchAll(rule.re)) {
      const due = rule.resolve(match, today);
      if (!due) continue;
      const explicit = match[0].includes('까지');
      const better =
        !best ||
        (explicit && !best.explicit) ||
        (explicit === best.explicit &&
          (match.index < best.index || (match.index === best.index && match[0].length > best.length)));
      if (better) best = { index: match.index, length: match[0].length, due, explicit };
    }
  }
  if (!best) return { text: input.trim() };
  const before = input.slice(0, best.index);
  const after = input.slice(best.index + best.length);
  const text = `${before} ${after}`.replace(/\s{2,}/g, ' ').trim();
  // 기한만 적었다면 할 일 내용이 없으니 기한으로 읽지 않는다.
  if (!text) return { text: input.trim() };
  return { text, due: best.due, matched: input.slice(best.index, best.index + best.length).trim() };
}
