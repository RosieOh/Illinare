import { describe, expect, it } from 'vitest';
import {
  barDomain,
  barGeometry,
  clampIndex,
  formatBarValue,
  presenterAction,
  slideLabel,
  sortDecks,
  statColumns,
  statValueSize,
} from '@/components/decks/layout';
import type { Deck } from '@/lib/contracts';

describe('막대 축', () => {
  it('기준선은 0이고 가장 큰 값까지 보여 준다', () => {
    expect(barDomain([{ label: 'a', value: 40 }, { label: 'b', value: 120 }])).toBe(120);
  });

  it('목표가 값보다 크면 목표까지 보여 준다', () => {
    expect(barDomain([{ label: 'a', value: 40, target: 90 }])).toBe(90);
  });

  it('퍼센트는 100까지 보여 준다', () => {
    expect(barDomain([{ label: 'a', value: 40, unit: '%' }])).toBe(100);
    expect(barDomain([{ label: 'a', value: 140, unit: '%' }])).toBe(140);
  });

  it('값이 모두 0이어도 0으로 나누지 않는다', () => {
    expect(barDomain([{ label: 'a', value: 0 }])).toBe(1);
    expect(barDomain([])).toBe(1);
  });

  it('위치를 퍼센트로 계산하고 범위를 벗어나지 않는다', () => {
    expect(barGeometry({ label: 'a', value: 50, target: 75 }, 100)).toEqual({ valuePct: 50, targetPct: 75 });
    expect(barGeometry({ label: 'a', value: 50 }, 100)).toEqual({ valuePct: 50, targetPct: null });
    expect(barGeometry({ label: 'a', value: -10 }, 100).valuePct).toBe(0);
    expect(barGeometry({ label: 'a', value: 200 }, 100).valuePct).toBe(100);
  });

  it('값을 단위와 함께 적는다', () => {
    expect(formatBarValue(72, '%')).toBe('72%');
    expect(formatBarValue(1234)).toBe('1,234');
    expect(formatBarValue(1.234, '배')).toBe('1.23배');
  });
});

describe('발표 키', () => {
  it('방향키, 스페이스, Home, End, Esc, G, N을 해석한다', () => {
    expect(presenterAction({ key: 'ArrowRight' })).toBe('next');
    expect(presenterAction({ key: ' ' })).toBe('next');
    expect(presenterAction({ key: 'ArrowLeft' })).toBe('prev');
    expect(presenterAction({ key: 'Home' })).toBe('first');
    expect(presenterAction({ key: 'End' })).toBe('last');
    expect(presenterAction({ key: 'Escape' })).toBe('exit');
    expect(presenterAction({ key: 'g' })).toBe('overview');
    expect(presenterAction({ key: 'N' })).toBe('notes');
  });

  it('한글 입력 상태에서도 G와 N이 동작한다', () => {
    expect(presenterAction({ key: 'ㅎ' })).toBe('overview');
    expect(presenterAction({ key: 'ㅜ' })).toBe('notes');
  });

  it('입력 중에는 어떤 키도 가로채지 않는다', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'Home', 'End', 'Escape', 'g', 'n']) {
      expect(presenterAction({ key, typing: true })).toBeNull();
    }
  });

  it('조합키는 가로채지 않는다', () => {
    expect(presenterAction({ key: 'ArrowRight', metaKey: true })).toBeNull();
    expect(presenterAction({ key: 'n', ctrlKey: true })).toBeNull();
    expect(presenterAction({ key: 'g', altKey: true })).toBeNull();
  });

  it('다른 키는 무시한다', () => {
    expect(presenterAction({ key: 'a' })).toBeNull();
  });
});

describe('기타', () => {
  it('인덱스는 범위 안으로 들어온다', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('슬라이드 이름은 인용이면 인용문이다', () => {
    expect(slideLabel({ type: 'quote', quote: '좋은 말' })).toBe('좋은 말');
    expect(slideLabel({ type: 'title', title: '제목' })).toBe('제목');
  });

  it('최근 자료가 앞에, 예시는 뒤에 온다', () => {
    const deck = (id: string, updatedAt: number, sample?: boolean): Deck => ({ id, title: id, slides: [], createdAt: 0, updatedAt, sample });
    const sorted = sortDecks([deck('sample', 999, true), deck('old', 1), deck('new', 5)]);
    expect(sorted.map((d) => d.id)).toEqual(['new', 'old', 'sample']);
  });
});

describe('수치 슬라이드', () => {
  it('열 수는 4개까지 넘치지 않게 나눈다', () => {
    expect([1, 2, 3, 4, 5, 6].map(statColumns)).toEqual([1, 2, 3, 2, 3, 3]);
  });

  it('긴 값이 있으면 글자를 줄여 한 줄에 넣는다', () => {
    const short = statValueSize(['46', '3.2%', '41분']);
    const long = statValueSize(['1,234,567,890원', '3.2%', '41분']);
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(32);
  });

  it('값이 하나면 크게 보여 준다', () => {
    expect(statValueSize(['99%'])).toBeGreaterThan(statValueSize(['99%', '98%', '97%']));
  });
});
