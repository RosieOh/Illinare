import { describe, expect, it } from 'vitest';
import { classifyRaw, DWELL_MS, GestureStabilizer, palmCenter, type GestureType, type Landmark } from '@/lib/client/gesture/classify';
import { GestureEngine, mapToViewport } from '@/lib/client/gesture/engine';
import { HOLD_MS, HoldTracker, SwipeDetector } from '@/lib/client/gesture/motion';
import { OneEuroFilter } from '@/lib/client/gesture/oneEuro';
import { looksLikeApproval, pickNearest, rectDistance } from '@/lib/client/gesture/snap';

interface HandOptions {
  fingers?: [boolean, boolean, boolean, boolean];
  pinch?: boolean;
  /** 손바닥 중심 위치 */
  cx?: number;
  cy?: number;
  scale?: number;
  rotation?: number;
  mirror?: boolean;
}

/** 손목에서 위로 뻗은 합성 손. 실제 MediaPipe 랜드마크 순서를 따른다. */
function hand({ fingers = [true, true, true, true], pinch = false, cx = 0.5, cy = 0.6, scale = 0.2, rotation = 0, mirror = false }: HandOptions = {}): Landmark[] {
  const local: [number, number][] = new Array(21).fill(null).map(() => [0, 0]);
  local[0] = [0, 0];
  // 엄지
  local[1] = [-0.3, -0.25];
  local[2] = [-0.55, -0.45];
  local[3] = [-0.7, -0.65];
  local[4] = pinch ? [-0.08, -1.62] : [-0.9, -0.8];

  const xs = [-0.3, -0.1, 0.1, 0.3];
  const bases = [5, 9, 13, 17];
  fingers.forEach((extended, i) => {
    const x = xs[i];
    const mcp = bases[i];
    local[mcp] = [x, -1];
    local[mcp + 1] = [x, -1.45];
    if (extended) {
      local[mcp + 2] = [x, -1.75];
      local[mcp + 3] = [x, -2.05];
    } else {
      // 접은 손가락: 끝이 손바닥 쪽으로 돌아온다.
      local[mcp + 2] = [x, -1.25];
      local[mcp + 3] = [x, -0.95];
    }
  });
  if (pinch) {
    // 검지는 엄지 쪽으로 구부러져 끝이 만난다.
    local[6] = [-0.3, -1.45];
    local[7] = [-0.2, -1.6];
    local[8] = [-0.08, -1.65];
  }

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return local.map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { x: (mirror ? -1 : 1) * rx * scale + cx, y: ry * scale + cy, z: 0 };
  });
}

const POINT: [boolean, boolean, boolean, boolean] = [true, false, false, false];
const PEACE: [boolean, boolean, boolean, boolean] = [true, true, false, false];
const FIST: [boolean, boolean, boolean, boolean] = [false, false, false, false];

describe('OneEuroFilter', () => {
  it('정지한 손의 떨림을 크게 줄인다', () => {
    const filter = new OneEuroFilter();
    let rawSpread = 0;
    let smoothSpread = 0;
    let previousSmooth = filter.filter(500, 0);
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += 33;
      const raw = 500 + (i % 2 === 0 ? 6 : -6);
      const smooth = filter.filter(raw, t);
      rawSpread += 12;
      smoothSpread += Math.abs(smooth - previousSmooth);
      previousSmooth = smooth;
    }
    expect(smoothSpread).toBeLessThan(rawSpread * 0.4);
  });

  it('빠르게 움직이면 지연이 작다', () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 0);
    let value = 0;
    for (let i = 1; i <= 10; i++) value = filter.filter(i * 100, i * 16);
    // 1000px까지 움직였을 때 뒤처짐이 작아야 한다.
    expect(1000 - value).toBeLessThan(120);
  });

  it('reset 뒤에는 첫 값을 그대로 돌려준다', () => {
    const filter = new OneEuroFilter();
    filter.filter(10, 0);
    filter.reset();
    expect(filter.filter(900, 16)).toBe(900);
  });
});

describe('classifyRaw', () => {
  const cases: [GestureType, HandOptions][] = [
    ['open', {}],
    ['point', { fingers: POINT }],
    ['peace', { fingers: PEACE }],
    ['fist', { fingers: FIST }],
    ['pinch', { pinch: true, fingers: [true, true, true, true] }],
  ];

  it.each(cases)('%s를 알아본다', (expected, options) => {
    expect(classifyRaw(hand(options))).toBe(expected);
  });

  it.each(cases)('왼손과 오른손을 가리지 않는다: %s', (expected, options) => {
    expect(classifyRaw(hand({ ...options, mirror: true }))).toBe(expected);
  });

  it.each(cases)('손을 기울여도 같다: %s', (expected, options) => {
    expect(classifyRaw(hand({ ...options, rotation: Math.PI / 2 }))).toBe(expected);
    expect(classifyRaw(hand({ ...options, rotation: Math.PI }))).toBe(expected);
  });

  it.each(cases)('카메라와의 거리가 달라도 같다: %s', (expected, options) => {
    expect(classifyRaw(hand({ ...options, scale: 0.06 }))).toBe(expected);
    expect(classifyRaw(hand({ ...options, scale: 0.28 }))).toBe(expected);
  });

  it('주먹을 집기로 오해하지 않는다', () => {
    const kp = hand({ fingers: FIST });
    // 엄지를 검지 위에 올린 주먹
    kp[4] = { ...kp[8] };
    expect(classifyRaw(kp)).toBe('fist');
  });

  it('랜드마크가 부족하면 none', () => {
    expect(classifyRaw(null)).toBe('none');
    expect(classifyRaw([{ x: 0, y: 0 }])).toBe('none');
  });

  it('집기는 시작보다 풀 때 문턱이 높아 경계에서 깜빡이지 않는다', () => {
    const kp = hand({ fingers: POINT });
    const palm = 0.2;
    // 엄지와 검지 끝 거리가 손 크기의 0.38배
    kp[4] = { x: kp[8].x + palm * 0.38, y: kp[8].y };
    expect(classifyRaw(kp, { previous: 'point' })).not.toBe('pinch');
    expect(classifyRaw(kp, { previous: 'pinch' })).toBe('pinch');
  });

  it('영상 비율을 반영해 거리를 잰다', () => {
    const kp = hand({ fingers: POINT });
    // x축으로만 떨어진 경우 가로로 긴 영상에서는 거리가 더 멀다
    kp[4] = { x: kp[8].x + 0.05, y: kp[8].y };
    expect(classifyRaw(kp, { aspect: 1 })).toBe('pinch');
    expect(classifyRaw(kp, { aspect: 16 / 9 })).not.toBe('pinch');
  });
});

describe('GestureStabilizer', () => {
  it('한두 프레임의 튐은 상태를 바꾸지 않는다', () => {
    const s = new GestureStabilizer();
    let t = 0;
    for (let i = 0; i < 10; i++) s.update('open', (t += 33));
    expect(s.stable).toBe('open');
    s.update('fist', (t += 33));
    s.update('open', (t += 33));
    s.update('none', (t += 33));
    s.update('open', (t += 33));
    expect(s.stable).toBe('open');
  });

  it('후보가 유지 시간을 넘기면 바뀐다', () => {
    const s = new GestureStabilizer();
    s.update('fist', 0);
    expect(s.stable).toBe('none');
    s.update('fist', DWELL_MS.fist - 1);
    expect(s.stable).toBe('none');
    s.update('fist', DWELL_MS.fist);
    expect(s.stable).toBe('fist');
  });

  it('집기는 다른 제스처보다 빠르게 잡는다', () => {
    expect(DWELL_MS.pinch).toBeLessThan(DWELL_MS.open);
  });
});

describe('SwipeDetector', () => {
  const run = (d: SwipeDetector, from: number, to: number, startT: number, frames = 8, eligible = true) => {
    const results: (string | null)[] = [];
    for (let i = 0; i <= frames; i++) {
      results.push(d.update(from + ((to - from) * i) / frames, 0.5, startT + i * 33, eligible));
    }
    return results.filter(Boolean);
  };

  it('화면 왼쪽으로 빠르게 움직이면 left', () => {
    expect(run(new SwipeDetector(), 0.8, 0.3, 0)).toEqual(['left']);
  });

  it('화면 오른쪽으로 빠르게 움직이면 right', () => {
    expect(run(new SwipeDetector(), 0.2, 0.7, 0)).toEqual(['right']);
  });

  it('느린 이동은 스와이프가 아니다', () => {
    const d = new SwipeDetector();
    const results: (string | null)[] = [];
    for (let i = 0; i < 60; i++) results.push(d.update(0.2 + i * 0.005, 0.5, i * 33, true));
    expect(results.filter(Boolean)).toEqual([]);
  });

  it('세로 이동은 스와이프가 아니다', () => {
    const d = new SwipeDetector();
    const results: (string | null)[] = [];
    for (let i = 0; i <= 8; i++) results.push(d.update(0.5 + i * 0.03, 0.2 + i * 0.08, i * 33, true));
    expect(results.filter(Boolean)).toEqual([]);
  });

  it('쿨다운 동안에는 다시 잡지 않고, 손을 되돌리는 동작을 반대 방향으로 잡지 않는다', () => {
    const d = new SwipeDetector();
    expect(run(d, 0.8, 0.3, 0)).toEqual(['left']);
    // 곧바로 손을 되돌린다.
    expect(run(d, 0.3, 0.8, 300)).toEqual([]);
    // 잠시 뒤 다시 왼쪽으로 쓸면 잡는다.
    expect(run(d, 0.8, 0.3, 1400)).toEqual(['left']);
  });

  it('자격이 없는 제스처로는 잡지 않는다', () => {
    expect(run(new SwipeDetector(), 0.8, 0.3, 0, 8, false)).toEqual([]);
  });
});

describe('HoldTracker', () => {
  it('1초를 채우면 한 번만 실행한다', () => {
    const h = new HoldTracker();
    let fired = 0;
    for (let t = 0; t <= 3000; t += 33) {
      if (h.update('open', 0, t).fired) fired++;
    }
    expect(fired).toBe(1);
  });

  it('제스처를 풀었다 다시 하면 또 실행한다', () => {
    const h = new HoldTracker();
    h.update('fist', 0, 0);
    expect(h.update('fist', 0, HOLD_MS).fired).toBe(true);
    h.update('point', 0, HOLD_MS + 100);
    h.update('fist', 0, HOLD_MS + 200);
    expect(h.update('fist', 0, HOLD_MS * 2 + 200).fired).toBe(true);
  });

  it('손이 빠르게 움직이는 동안에는 진행하지 않는다', () => {
    const h = new HoldTracker();
    let last = h.update('open', 0, 0);
    for (let t = 33; t <= 2000; t += 33) last = h.update('open', 1.2, t);
    expect(last.fired).toBe(false);
    expect(last.progress).toBe(0);
  });

  it('유지 대상이 아닌 제스처는 무시한다', () => {
    const h = new HoldTracker();
    expect(h.update('point', 0, 0)).toEqual({ kind: null, progress: 0, fired: false });
  });
});

describe('좌표 매핑', () => {
  const viewport = { width: 1000, height: 500 };

  it('selfieMode 좌표에서 손이 오른쪽에 있으면 화면 오른쪽이다', () => {
    const left = mapToViewport(0.3, 0.5, viewport);
    const right = mapToViewport(0.7, 0.5, viewport);
    expect(right.x).toBeGreaterThan(left.x);
  });

  it('활성 영역 끝에서 화면 끝에 닿고, 밖은 잘린다', () => {
    expect(mapToViewport(0, 0, viewport)).toEqual({ x: 0, y: 0 });
    expect(mapToViewport(1, 1, viewport)).toEqual({ x: 1000, y: 500 });
  });
});

describe('GestureEngine', () => {
  const viewport = { width: 1000, height: 800 };
  const frame = (t: number, landmarks: Landmark[] | null) => ({ timeMs: t, landmarks, viewport, aspect: 1 });

  it('손이 보이지 않으면 잠시 뒤 커서를 숨긴다', () => {
    const engine = new GestureEngine();
    expect(engine.process(frame(0, hand({ fingers: POINT }))).cursor).not.toBeNull();
    expect(engine.process(frame(100, null)).cursor).not.toBeNull();
    expect(engine.process(frame(1000, null)).cursor).toBeNull();
  });

  it('집기는 시작 프레임에 한 번만 누른다', () => {
    const engine = new GestureEngine();
    let t = 0;
    for (let i = 0; i < 12; i++) engine.process(frame((t += 33), hand({ fingers: POINT })));
    const clicks = [];
    for (let i = 0; i < 12; i++) {
      const output = engine.process(frame((t += 33), hand({ pinch: true })));
      if (output.click) clicks.push(output.click);
    }
    expect(clicks).toHaveLength(1);
  });

  it('누르는 위치는 손가락을 모으기 전의 위치다', () => {
    const engine = new GestureEngine();
    let t = 0;
    let settled = { x: 0, y: 0 };
    for (let i = 0; i < 40; i++) {
      const output = engine.process(frame((t += 33), hand({ fingers: POINT, cx: 0.5 })));
      settled = output.cursor ?? settled;
    }
    // 집으면서 손이 크게 움직여도, 직전에 머물던 자리를 누른다.
    let click = null;
    for (let i = 0; i < 6 && !click; i++) {
      click = engine.process(frame((t += 33), hand({ pinch: true, cx: 0.5 + i * 0.02 }))).click;
    }
    expect(click).not.toBeNull();
    expect(Math.abs((click?.x ?? 0) - settled.x)).toBeLessThan(40);
  });

  it('스와이프 중의 손바닥은 유지로 세지 않는다', () => {
    const engine = new GestureEngine();
    let t = 0;
    for (let i = 0; i < 8; i++) engine.process(frame((t += 33), hand({ cx: 0.8 })));
    let swipe = null;
    let fired = null;
    for (let i = 0; i < 10; i++) {
      const output = engine.process(frame((t += 33), hand({ cx: 0.8 - i * 0.06 })));
      swipe = output.swipe ?? swipe;
      fired = output.holdFired ?? fired;
    }
    expect(swipe).toBe('left');
    expect(fired).toBeNull();
  });

  it('손바닥을 가만히 1초 유지하면 실행한다', () => {
    const engine = new GestureEngine();
    let t = 0;
    let fired = null;
    for (let i = 0; i < 50; i++) {
      fired = engine.process(frame((t += 33), hand())).holdFired ?? fired;
    }
    expect(fired).toBe('open');
  });

  it('palmCenter는 손바닥 안에 있다', () => {
    const kp = hand({ cx: 0.5, cy: 0.6 });
    const center = palmCenter(kp);
    expect(center.x).toBeCloseTo(0.5, 1);
    expect(center.y).toBeLessThan(0.6);
  });
});

describe('누를 대상 고르기', () => {
  const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

  it('안쪽이면 거리 0', () => {
    expect(rectDistance(rect(0, 0, 10, 10), 5, 5)).toBe(0);
  });

  it('가장 가까운 것을 반경 안에서 고른다', () => {
    const items = [
      { id: 'a', rect: rect(0, 0, 10, 10) },
      { id: 'b', rect: rect(100, 0, 10, 10) },
    ];
    expect(pickNearest(items, 30, 5, 44)?.id).toBe('a');
    expect(pickNearest(items, 80, 5, 44)?.id).toBe('b');
    expect(pickNearest(items, 55, 200, 44)).toBeNull();
  });
});

describe('제스처 승인 차단', () => {
  it.each(['승인', '모두 승인', '계획 승인', '항상 허용', 'Approve', 'allow'])('%s는 승인으로 본다', (label) => {
    expect(looksLikeApproval(label)).toBe(true);
  });

  it.each(['거부 안 함', '다음 슬라이드', '발표 시작', '', null])('%s는 승인이 아니다', (label) => {
    expect(looksLikeApproval(label)).toBe(false);
  });
});
