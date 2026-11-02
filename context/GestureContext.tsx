'use client';

import { useSyncExternalStore } from 'react';
import type { GestureType } from '@/lib/client/gesture/classify';
import type { SwipeDirection } from '@/lib/client/gesture/motion';

/**
 * 제스처 상태 저장소. 프로바이더 없이 어디서나 구독한다.
 * 커서 좌표처럼 매 프레임 바뀌는 값은 React 상태로 올리지 않고 구독자가 DOM을 직접 고친다.
 */
export type GesturePhase =
  | 'off'
  | 'requesting'
  | 'loading'
  | 'ready'
  | 'paused'
  | 'denied'
  | 'no-camera'
  | 'busy'
  | 'model-failed'
  | 'unsupported';

export interface GestureSnapshot {
  phase: GesturePhase;
  gesture: GestureType;
  handVisible: boolean;
}

const INITIAL: GestureSnapshot = { phase: 'off', gesture: 'none', handVisible: false };

let snapshot = INITIAL;
const stateListeners = new Set<() => void>();

export function setGestureState(patch: Partial<GestureSnapshot>) {
  const next = { ...snapshot, ...patch };
  if (next.phase === snapshot.phase && next.gesture === snapshot.gesture && next.handVisible === snapshot.handVisible) return;
  snapshot = next;
  stateListeners.forEach((fn) => fn());
}

function subscribeState(fn: () => void) {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

export function useGestureState(): GestureSnapshot {
  return useSyncExternalStore(
    subscribeState,
    () => snapshot,
    () => INITIAL
  );
}

// ─── 스와이프 ────────────────────────────────────────────────
const swipeListeners = new Set<(direction: SwipeDirection) => void>();

export function emitSwipe(direction: SwipeDirection) {
  swipeListeners.forEach((fn) => fn(direction));
}

/** 발표 화면처럼 스와이프에 반응하는 쪽에서 구독한다. 구독자가 없으면 스와이프는 아무 일도 하지 않는다. */
export function subscribeSwipe(fn: (direction: SwipeDirection) => void) {
  swipeListeners.add(fn);
  return () => {
    swipeListeners.delete(fn);
  };
}

// ─── 커서 ────────────────────────────────────────────────────
export interface CursorFrame {
  visible: boolean;
  x: number;
  y: number;
  pinching: boolean;
  /** 가까운 버튼에 달라붙었는가 */
  snapped: boolean;
  /** 유지 제스처 진행률 0~1. 0이면 표시하지 않는다 */
  hold: number;
  holdLabel: string;
}

export const cursorFrame: CursorFrame = {
  visible: false,
  x: 0,
  y: 0,
  pinching: false,
  snapped: false,
  hold: 0,
  holdLabel: '',
};

const cursorListeners = new Set<() => void>();

export function publishCursor(patch: Partial<CursorFrame>) {
  Object.assign(cursorFrame, patch);
  cursorListeners.forEach((fn) => fn());
}

export function subscribeCursor(fn: () => void) {
  cursorListeners.add(fn);
  return () => {
    cursorListeners.delete(fn);
  };
}
