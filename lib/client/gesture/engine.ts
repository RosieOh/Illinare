import { classifyRaw, GestureStabilizer, palmCenter, type GestureType, type Landmark } from './classify';
import { HoldTracker, SwipeDetector, type HoldKind, type SwipeDirection } from './motion';
import { OneEuroFilter } from './oneEuro';

export interface EngineFrame {
  timeMs: number;
  /** selfieMode로 좌우 반전된 좌표. 없으면 손이 보이지 않는 프레임 */
  landmarks: readonly Landmark[] | null;
  viewport: { width: number; height: number };
  /** 영상 가로세로 비. 정규화 좌표의 거리를 실제 비율로 되돌린다 */
  aspect: number;
}

export interface EngineOutput {
  handVisible: boolean;
  gesture: GestureType;
  /** 화면 좌표. 손이 한동안 안 보이면 null */
  cursor: { x: number; y: number } | null;
  pinching: boolean;
  /** 이번 프레임에 집기가 시작되어 눌러야 할 위치 */
  click: { x: number; y: number } | null;
  swipe: SwipeDirection | null;
  holdKind: HoldKind | null;
  holdProgress: number;
  holdFired: HoldKind | null;
}

/** 손이 프레임 가장자리로 나가지 않아도 화면 끝까지 닿도록 가운데 영역을 화면 전체에 대응시킨다. */
const ACTIVE_BOX = { left: 0.16, right: 0.84, top: 0.14, bottom: 0.78 };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mapToViewport(x: number, y: number, viewport: EngineFrame['viewport']) {
  return {
    x: clamp01((x - ACTIVE_BOX.left) / (ACTIVE_BOX.right - ACTIVE_BOX.left)) * viewport.width,
    y: clamp01((y - ACTIVE_BOX.top) / (ACTIVE_BOX.bottom - ACTIVE_BOX.top)) * viewport.height,
  };
}

/** 손가락을 모으는 동안 검지가 움직이므로, 집기 직전 위치를 누른다. */
const CLICK_LOOKBACK_MS = 140;
const CLICK_COOLDOWN_MS = 350;
const CURSOR_TIMEOUT_MS = 400;

export class GestureEngine {
  private readonly stabilizer = new GestureStabilizer();
  private readonly swipe = new SwipeDetector();
  private readonly hold = new HoldTracker();
  private readonly filterX = new OneEuroFilter();
  private readonly filterY = new OneEuroFilter();
  private history: { t: number; x: number; y: number }[] = [];
  private cursor: { x: number; y: number } | null = null;
  private wasPinching = false;
  private lastClickAt = Number.NEGATIVE_INFINITY;
  private lastSeenAt = Number.NEGATIVE_INFINITY;
  private lastPalm: { t: number; x: number; y: number } | null = null;

  process(frame: EngineFrame): EngineOutput {
    const { timeMs: t, landmarks, viewport, aspect } = frame;

    if (!landmarks || landmarks.length < 21) {
      const gesture = this.stabilizer.update('none', t);
      this.swipe.reset();
      this.hold.reset();
      this.lastPalm = null;
      this.wasPinching = false;
      if (t - this.lastSeenAt > CURSOR_TIMEOUT_MS) {
        this.cursor = null;
        this.history = [];
        this.filterX.reset();
        this.filterY.reset();
      }
      return {
        handVisible: false,
        gesture,
        cursor: this.cursor,
        pinching: false,
        click: null,
        swipe: null,
        holdKind: null,
        holdProgress: 0,
        holdFired: null,
      };
    }

    this.lastSeenAt = t;
    const raw = classifyRaw(landmarks, { aspect, previous: this.stabilizer.stable });
    const gesture = this.stabilizer.update(raw, t);
    const pinching = gesture === 'pinch';

    // 집는 동안과 주먹을 쥔 동안에는 검지 끝이 믿을 만한 위치가 아니므로 커서를 멈춘다.
    if (!pinching && gesture !== 'fist') {
      const mapped = mapToViewport(landmarks[8].x, landmarks[8].y, viewport);
      this.cursor = { x: this.filterX.filter(mapped.x, t), y: this.filterY.filter(mapped.y, t) };
      this.history.push({ t, ...this.cursor });
      while (this.history.length && t - this.history[0].t > 400) this.history.shift();
    }

    let click: EngineOutput['click'] = null;
    if (pinching && !this.wasPinching && t - this.lastClickAt >= CLICK_COOLDOWN_MS && this.cursor) {
      const before = [...this.history].reverse().find((entry) => t - entry.t >= CLICK_LOOKBACK_MS);
      click = before ? { x: before.x, y: before.y } : { ...this.cursor };
      this.cursor = { ...click };
      this.lastClickAt = t;
    }
    this.wasPinching = pinching;

    const palm = palmCenter(landmarks);
    const speed = this.lastPalm
      ? Math.hypot(palm.x - this.lastPalm.x, palm.y - this.lastPalm.y) / Math.max(0.001, (t - this.lastPalm.t) / 1000)
      : 0;
    this.lastPalm = { t, ...palm };

    const swipe = this.swipe.update(palm.x, palm.y, t, gesture === 'open' || gesture === 'peace');
    if (swipe) this.hold.reset();
    const hold = this.hold.update(gesture, speed, t);

    return {
      handVisible: true,
      gesture,
      cursor: this.cursor,
      pinching,
      click,
      swipe,
      holdKind: hold.kind,
      holdProgress: hold.progress,
      holdFired: hold.fired ? hold.kind : null,
    };
  }

  reset() {
    this.stabilizer.reset();
    this.swipe.reset();
    this.hold.reset();
    this.filterX.reset();
    this.filterY.reset();
    this.history = [];
    this.cursor = null;
    this.wasPinching = false;
    this.lastPalm = null;
    this.lastClickAt = Number.NEGATIVE_INFINITY;
    this.lastSeenAt = Number.NEGATIVE_INFINITY;
  }
}
