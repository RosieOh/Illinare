'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

function subscribe(callback: () => void) {
  subscribers.add(callback);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      subscribers.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** 셸이 숨은 뷰에 false를 내려 준다. 모든 뷰가 마운트되어 있으므로 숨은 뷰의 시계는 멈춘다. */
export const ViewActiveContext = createContext(true);

const subscribeNever = () => () => undefined;

/**
 * 1초마다 갱신되는 현재 시각(ms). 하이드레이션 전에는 0을 돌려준다.
 * 렌더 중에 Date.now()를 직접 부르지 말고 이 훅을 쓴다.
 */
export function useNow(): number {
  const active = useContext(ViewActiveContext);
  return useSyncExternalStore(
    active ? subscribe : subscribeNever,
    () => now,
    () => 0
  );
}
