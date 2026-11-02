'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toIso } from './dates';

/**
 * 분 단위로 갱신되는 현재 시각의 분 번호. 하이드레이션 전에는 0.
 * 보이지 않는 뷰는 active=false로 타이머를 멈춘다.
 */
export function useMinute(active = true): number {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!active) return () => undefined;
      const id = setInterval(callback, 10_000);
      return () => clearInterval(id);
    },
    [active]
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 60_000),
    () => 0
  );
}

/** 1초마다 갱신되는 현재 시각(ms). 하이드레이션 전에는 0. 숨겨진 뷰는 active=false로 다시 그리지 않는다. */
export function useSecondClock(active = true): number {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!active) return () => undefined;
      const id = setInterval(callback, 1000);
      return () => clearInterval(id);
    },
    [active]
  );
  const second = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => 0
  );
  return second * 1000;
}

/** 분 번호에서 오늘 날짜(YYYY-MM-DD). 하이드레이션 전에는 빈 문자열. */
export function minuteToIso(minute: number): string {
  return minute ? toIso(new Date(minute * 60_000)) : '';
}

/** 그날 자정부터 지난 분 */
export function minuteOfDay(minute: number): number {
  if (!minute) return 0;
  const d = new Date(minute * 60_000);
  return d.getHours() * 60 + d.getMinutes();
}

/** 체크한 항목을 잠시 제자리에 남겨 체크 애니메이션이 보이게 한다. */
export function useLingering(ms = 700) {
  const [lingering, setLingering] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const linger = useCallback(
    (id: string) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      setLingering((cur) => new Set(cur).add(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setLingering((cur) => {
            const next = new Set(cur);
            next.delete(id);
            return next;
          });
        }, ms)
      );
    },
    [ms]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return { lingering, linger };
}
