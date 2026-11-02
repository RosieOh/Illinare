import type { GestureType } from './classify';

/** 스와이프와 길게 유지하기. 좌표는 selfieMode로 좌우 반전된 값이라 화면 방향과 같다. */
export type SwipeDirection = 'left' | 'right';

export interface SwipeOptions {
  windowMs?: number;
  /** 화면 너비 대비 이동 거리 */
  minDistance?: number;
  /** 가로 이동이 세로 이동보다 몇 배 커야 하는가 */
  dominance?: number;
  cooldownMs?: number;
  /** 손을 되돌리는 동작이 반대 방향 스와이프로 잡히지 않게 막는 시간 */
  oppositeLockMs?: number;
}

export class SwipeDetector {
  private readonly windowMs: number;
  private readonly minDistance: number;
  private readonly dominance: number;
  private readonly cooldownMs: number;
  private readonly oppositeLockMs: number;
  private history: { t: number; x: number; y: number }[] = [];
  private lastSwipeAt = Number.NEGATIVE_INFINITY;
  private lastDirection: SwipeDirection | null = null;

  constructor(options: SwipeOptions = {}) {
    this.windowMs = options.windowMs ?? 420;
    this.minDistance = options.minDistance ?? 0.2;
    this.dominance = options.dominance ?? 1.8;
    this.cooldownMs = options.cooldownMs ?? 800;
    this.oppositeLockMs = options.oppositeLockMs ?? 1100;
  }

  update(x: number, y: number, timeMs: number, eligible: boolean): SwipeDirection | null {
    if (!eligible) {
      this.history = [];
      return null;
    }
    this.history.push({ t: timeMs, x, y });
    while (this.history.length && timeMs - this.history[0].t > this.windowMs) this.history.shift();
    if (timeMs - this.lastSwipeAt < this.cooldownMs || this.history.length < 2) return null;

    const first = this.history[0];
    const dx = x - first.x;
    const dy = y - first.y;
    if (Math.abs(dx) < this.minDistance || Math.abs(dx) < Math.abs(dy) * this.dominance) return null;

    const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
    if (this.lastDirection && direction !== this.lastDirection && timeMs - this.lastSwipeAt < this.oppositeLockMs) {
      return null;
    }
    this.lastSwipeAt = timeMs;
    this.lastDirection = direction;
    this.history = [];
    return direction;
  }

  reset() {
    this.history = [];
  }
}

export const HOLD_MS = 1000;
/** 손이 이보다 빠르게 움직이면 (화면 너비/초) 유지로 보지 않는다. 스와이프 중의 손바닥이 여기 걸리지 않게 한다. */
export const HOLD_MAX_SPEED = 0.35;

export type HoldKind = 'open' | 'fist';

export interface HoldState {
  kind: HoldKind | null;
  /** 0~1 */
  progress: number;
  /** 이번 프레임에 유지가 완성되었는가 */
  fired: boolean;
}

export class HoldTracker {
  private kind: HoldKind | null = null;
  private since = 0;
  private done = false;

  update(gesture: GestureType, palmSpeed: number, timeMs: number): HoldState {
    const kind: HoldKind | null = gesture === 'open' || gesture === 'fist' ? gesture : null;
    if (kind !== this.kind) {
      this.kind = kind;
      this.since = timeMs;
      this.done = false;
    }
    if (!kind) return { kind: null, progress: 0, fired: false };
    // 한 번 실행되면 제스처를 풀 때까지 다시 실행하지 않는다.
    if (this.done) return { kind, progress: 0, fired: false };
    if (palmSpeed > HOLD_MAX_SPEED) this.since = timeMs;

    const progress = Math.min(1, (timeMs - this.since) / HOLD_MS);
    if (progress >= 1) {
      this.done = true;
      return { kind, progress: 1, fired: true };
    }
    return { kind, progress, fired: false };
  }

  reset() {
    this.kind = null;
    this.since = 0;
    this.done = false;
  }
}
