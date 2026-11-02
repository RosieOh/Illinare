/**
 * 손 랜드마크 21개를 제스처로 분류한다. DOM을 쓰지 않는 순수 코드.
 * 손가락이 펴졌는지는 손목으로부터의 거리 비율로 판단하므로 손을 기울이거나 뒤집어도,
 * 왼손이든 오른손이든, 카메라와의 거리가 달라도 같은 결과가 나온다.
 */
export type GestureType = 'none' | 'point' | 'pinch' | 'open' | 'fist' | 'peace';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;
const INDEX_TIP = 8;

/** [끝 마디, 둘째 마디] */
const FINGERS: ReadonlyArray<readonly [number, number]> = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

/** 검지, 중지, 약지, 소지의 펴짐 패턴 */
const PATTERNS: Partial<Record<GestureType, readonly [boolean, boolean, boolean, boolean]>> = {
  open: [true, true, true, true],
  peace: [true, true, false, false],
  point: [true, false, false, false],
  fist: [false, false, false, false],
};

const EXTENDED_RATIO = 1.1;
/** 직전 상태를 유지하기 쉽게 하는 폭. 경계에서 상태가 깜빡이지 않게 한다. */
const EXTENDED_HYSTERESIS = 0.08;

export const PINCH_ENTER = 0.3;
export const PINCH_EXIT = 0.46;

function distance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** 손 크기. 거리 임계값을 이 값으로 나눠 카메라 거리와 무관하게 만든다. */
export function palmSize(kp: readonly Landmark[], aspect = 1): number {
  return distance(kp[WRIST], kp[MIDDLE_MCP], aspect) || 1e-6;
}

/** 손바닥 중심 (좌표는 selfieMode가 이미 좌우 반전한 값) */
export function palmCenter(kp: readonly Landmark[]): { x: number; y: number } {
  const points = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
  return {
    x: points.reduce((sum, i) => sum + kp[i].x, 0) / points.length,
    y: points.reduce((sum, i) => sum + kp[i].y, 0) / points.length,
  };
}

export function classifyRaw(
  kp: readonly Landmark[] | null | undefined,
  { aspect = 1, previous = 'none' as GestureType } = {}
): GestureType {
  if (!kp || kp.length < 21) return 'none';

  const palm = palmSize(kp, aspect);
  const pinchRatio = distance(kp[THUMB_TIP], kp[INDEX_TIP], aspect) / palm;
  const pinchLimit = previous === 'pinch' ? PINCH_EXIT : PINCH_ENTER;
  // 주먹을 쥐면 엄지와 검지 끝이 가까워지므로, 검지가 손바닥 밖에 있을 때만 집기로 본다.
  const indexOutside = distance(kp[INDEX_TIP], kp[WRIST], aspect) > distance(kp[INDEX_MCP], kp[WRIST], aspect) * 1.05;
  if (pinchRatio < pinchLimit && indexOutside) return 'pinch';

  const previousPattern = PATTERNS[previous];
  const extended = FINGERS.map(([tip, pip], i) => {
    const ratio = distance(kp[tip], kp[WRIST], aspect) / (distance(kp[pip], kp[WRIST], aspect) || 1e-6);
    const bias = previousPattern ? (previousPattern[i] ? -EXTENDED_HYSTERESIS : EXTENDED_HYSTERESIS) : 0;
    return ratio > EXTENDED_RATIO + bias;
  });

  for (const gesture of ['open', 'peace', 'point', 'fist'] as const) {
    const pattern = PATTERNS[gesture];
    if (pattern?.every((value, i) => value === extended[i])) return gesture;
  }
  return 'none';
}

/** 후보가 이 시간(ms) 동안 이어져야 상태가 바뀐다. 집기는 클릭이라 빠르게 반응한다. */
export const DWELL_MS: Record<GestureType, number> = {
  none: 180,
  point: 60,
  pinch: 30,
  open: 110,
  fist: 140,
  peace: 110,
};

export class GestureStabilizer {
  stable: GestureType = 'none';
  private candidate: GestureType | null = null;
  private candidateSince = 0;

  update(raw: GestureType, timeMs: number): GestureType {
    if (raw === this.stable) {
      this.candidate = null;
      return this.stable;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = timeMs;
    }
    if (timeMs - this.candidateSince >= DWELL_MS[raw]) {
      this.stable = raw;
      this.candidate = null;
    }
    return this.stable;
  }

  reset() {
    this.stable = 'none';
    this.candidate = null;
    this.candidateSince = 0;
  }
}
