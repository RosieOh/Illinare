'use client';

import { useEffect } from 'react';

const WINDOW_MS = 4000;
/** 이보다 프레임 간격이 길면 렌즈 값을 못 치르는 것이다 (20fps) */
const SLOW_GAP_MS = 50;
const SLOW_WINDOWS = 2;

/** 한 구간이 느렸는가. 잠깐의 끊김에 흔들리지 않도록 중앙값을 본다. */
export function isSlowWindow(gaps: number[]): boolean {
  if (gaps.length === 0) return false;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] > SLOW_GAP_MS;
}

/**
 * 렌즈는 움직이는 배경 위에서 매 프레임 비용을 낸다. 보이는 동안 두 구간 연속 느리면 이번 실행에서는 끄고 프로스트만 남긴다.
 * 다시 켜지 않는다: 켜고 끄기를 반복하면 유리가 깜박인다.
 */
export function useLensBudget() {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let started = 0;
    let slow = 0;
    let gaps: number[] = [];

    const reset = () => {
      last = 0;
      started = 0;
      slow = 0;
      gaps = [];
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (last) gaps.push(now - last);
      last = now;
      started ||= now;
      if (now - started < WINDOW_MS) return;
      slow = isSlowWindow(gaps) ? slow + 1 : 0;
      gaps = [];
      started = now;
      if (slow >= SLOW_WINDOWS) {
        document.documentElement.dataset.lensBudget = 'low';
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      reset();
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };

    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
