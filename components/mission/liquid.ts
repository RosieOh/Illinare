/**
 * 유리구 안의 액체. 미션 상태를 "얼마나 차 있는가"로 옮기고, 임의의 시각 t의 모습을 계산한다.
 * DOM과 시계를 모르는 순수 함수다: 같은 모델과 t를 주면 항상 같은 프레임이 나온다.
 * 덕분에 렌더러(LiquidLayer)는 얇게 유지되고, 목이 끊기는 순간을 테스트로 고정해 볼 수 있다.
 */
import type { MissionView, StepStatus } from '@/lib/contracts';
import { AGENTS } from '@/lib/contracts';
import { ANSWER_NODE, computeDepths, CONDUCTOR_NODE, pointOnPoints, type EdgePoints, type StageEdge, type StageLayout, type StageNode } from './layout';
import { answerStatus, conductorStatus, edgeColorVar, edgeState, type EdgeState } from './status';

// ─── 목표 상태 ───────────────────────────────────────────────
export interface PoolTarget {
  /** 0(빈 구) ~ 1(가득) */
  level: number;
  /** 아래에서 위로 쌓이는 색. 여러 색이면 층이 진다. */
  colors: string[];
  /** 출렁임 세기 0~1. 0이면 잔잔하다 */
  slosh: number;
}

const FULL_LEVEL = 0.68;
const CONDUCTOR_FULL = 0.72;
/** 미션이 끝나면 모든 구가 결과 구로 흘러들고 바닥에 자국만 남는다 */
const DRAINED_LEVEL = 0.05;
const RESULT_FULL = 0.84;
const COLOR_ACCENT = 'var(--accent)';
const COLOR_DANGER = 'var(--danger)';
const COLOR_MUTED = 'var(--label-3)';

/** 단계 상태 → 액체. 데이터와 1:1. */
export function stepPool(status: StepStatus, color: string, toolCalls: number, received: number): PoolTarget {
  switch (status) {
    case 'running':
      // 도구를 더 쓸수록 조금씩 차오른다. 실제 진행을 그대로 반영한다.
      return { level: Math.min(0.44 + toolCalls * 0.05, 0.62), colors: [color], slosh: 1 };
    case 'awaiting_approval':
      return { level: Math.min(0.44 + toolCalls * 0.05, 0.62), colors: [color], slosh: 0 };
    case 'done':
      // 꽉 채우면 불투명한 공처럼 보인다. 위에 공기층과 수면을 남겨 액체임을 읽히게 한다.
      return { level: FULL_LEVEL, colors: [color], slosh: 0 };
    case 'failed':
      return { level: 0.14, colors: [COLOR_DANGER], slosh: 0 };
    case 'cancelled':
      return { level: 0.14, colors: [COLOR_MUTED], slosh: 0 };
    case 'skipped':
      return { level: 0, colors: [color], slosh: 0 };
    default:
      // 앞 단계에서 이미 도착한 결과가 있으면 바닥에 조금 고여 있다.
      return { level: received > 0 ? 0.12 * received : 0, colors: [color], slosh: 0 };
  }
}

/** 지휘자는 파란 액체로 가득 찬 채 시작해 일을 나눠 줄 때마다 줄어든다. */
function conductorPool(view: MissionView): PoolTarget {
  const color = `var(${AGENTS.conductor.colorVar})`;
  const status = conductorStatus(view);
  if (status === 'failed') return { level: 0.14, colors: [COLOR_DANGER], slosh: 0 };
  if (status === 'cancelled') return { level: 0.14, colors: [COLOR_MUTED], slosh: 0 };
  if (view.status === 'done') return { level: DRAINED_LEVEL, colors: [color], slosh: 0 };
  const total = view.stepOrder.length;
  if (total === 0) {
    if (view.status === 'planning') return { level: CONDUCTOR_FULL, colors: [color], slosh: 1 };
    if (view.status === 'awaiting_plan') return { level: CONDUCTOR_FULL, colors: [color], slosh: 0 };
    const out = answerStatus(view) === 'done' ? 0.38 : answerStatus(view) === 'running' ? 0.52 : CONDUCTOR_FULL;
    return { level: out, colors: [color], slosh: answerStatus(view) === 'running' ? 0.6 : 0 };
  }
  const started = view.stepOrder.filter((id) => view.steps[id]?.status !== 'pending').length;
  return { level: CONDUCTOR_FULL - 0.34 * (started / total), colors: [color], slosh: view.status === 'planning' ? 1 : 0 };
}

/** 끝난 단계의 색, 끝난 순서대로. 결과 구와 답변 표면이 같은 색을 쓴다. */
export function finishedColors(view: MissionView): string[] {
  return view.stepOrder
    .map((id) => view.steps[id])
    .filter((s) => s?.status === 'done')
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .map((s) => `var(${AGENTS[s.step.agent].colorVar})`);
}

export function mergedColor(color: string): string {
  return `color-mix(in oklab, ${color} 12%, var(--accent))`;
}

/**
 * 결과 구는 비어서 시작한다. 들어오는 관(마지막 단계들)으로 물방울이 건너와야 비로소 찬다.
 * 관이 말라 있는데 액체가 있으면 어디서 왔는지 설명되지 않는다.
 */
function answerPool(view: MissionView, edges: Array<Pick<StageEdge, 'from' | 'to'>>): PoolTarget {
  const status = answerStatus(view);
  if (status === 'failed' && view.stepOrder.length === 0) return { level: 0.1, colors: [COLOR_DANGER], slosh: 0 };
  const colors = finishedColors(view);
  // 합쳐진 뒤에는 한 액체다. 기여한 에이전트의 색은 띠가 아니라 한 몸 안의 옅은 결로만 남는다.
  const palette = colors.length > 0 ? colors.map(mergedColor) : [`var(${AGENTS.conductor.colorVar})`];
  const total = view.stepOrder.length;
  if (status === 'done') return { level: RESULT_FULL, colors: palette, slosh: 0 };
  if (status === 'running') return { level: total > 0 ? Math.max(0.56, 0.44 * (colors.length / total) + 0.12) : 0.5, colors: palette, slosh: 0.7 };
  const feeders = edges.filter((e) => e.to === ANSWER_NODE && view.steps[e.from]);
  const delivered = feeders.filter((e) => view.steps[e.from]?.status === 'done').length;
  if (delivered === 0) return { level: 0, colors: palette, slosh: 0 };
  const level = 0.44 * (delivered / feeders.length);
  if (status === 'failed' || status === 'cancelled') return { level, colors: [COLOR_MUTED], slosh: 0 };
  return { level, colors: palette, slosh: 0 };
}

/** 미션 상태 → 구별 목표. 순수 함수. */
export function deriveTargets(view: MissionView, edges: Array<Pick<StageEdge, 'from' | 'to'>>): Map<string, PoolTarget> {
  const targets = new Map<string, PoolTarget>();
  targets.set(CONDUCTOR_NODE, conductorPool(view));
  targets.set(ANSWER_NODE, answerPool(view, edges));
  for (const id of view.stepOrder) {
    const step = view.steps[id];
    if (!step) continue;
    const color = `var(${AGENTS[step.step.agent].colorVar})`;
    const incoming = edges.filter((e) => e.to === id);
    const received = incoming.filter((e) => view.steps[e.from]?.status === 'done').length;
    const pool = stepPool(step.status, color, step.toolCalls.length, received);
    targets.set(id, view.status === 'done' && step.status === 'done' ? { ...pool, level: DRAINED_LEVEL } : pool);
  }
  return targets;
}

// ─── 모델 ────────────────────────────────────────────────────
interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

export interface PoolModel {
  id: string;
  cx: Tween;
  cy: Tween;
  /** 구 바깥 반지름 (목은 여기서 멈춘다) */
  r: Tween;
  level: Tween;
  colors: string[];
  slosh: Tween;
  /** 물방울이 도착해 출렁인 시각들 */
  splashes: number[];
  /** 이 시각 전에는 수위가 오르지 않는다: 건너오는 물방울이 도착하는 때 */
  gate: number;
  /** 위상을 구마다 다르게 한다 */
  seed: number;
}

export interface EdgeModel {
  id: string;
  from: string;
  to: string;
  kind: StageEdge['kind'];
  state: EdgeState;
  color: string;
  prev: EdgePoints;
  next: EdgePoints;
  moveStart: number;
  moveDuration: number;
  flowSince: number;
  /** 흐를 때의 목 굵기와 작은 방울 크기 (작은 구 묶음은 가늘게) */
  neckWidth?: number;
  beadRadius?: number;
}

export interface BeadModel {
  edgeId: string;
  color: string;
  start: number;
  duration: number;
  radius: number;
  /** 출발지에서 목이 늘어났다가 끊어지는 표현 */
  neck: boolean;
  /** 경로의 어디까지 가는지 (계획 중 맺혔다 사라지는 방울) */
  until: number;
  fade: boolean;
  /** 받는 구의 벽을 타고 흘러내리는 시간 (duration의 비율) */
  tail: number;
}

export interface LiquidModel {
  pools: Map<string, PoolModel>;
  edges: Map<string, EdgeModel>;
  beads: BeadModel[];
}

export function emptyModel(): LiquidModel {
  return { pools: new Map(), edges: new Map(), beads: [] };
}

export const MOVE_MS = 680;
export const LEVEL_MS = 1100;
/** 물방울 하나가 건너가는 시간. 읽을 수 있을 만큼 천천히. */
export const BEAD_MS = 950;
const FLOW_PERIOD_MS = 1500;
const NECK_BEADS = 14;
/** 물방울이 먼저 건너간 뒤에 굵은 목이 자라난다. 그래야 분리되는 순간이 보인다. */
const NECK_DELAY_MS = BEAD_MS * 0.72;
const NECK_GROW_MS = 520;
/** 물방울이 벽에 닿는 때. 받는 구의 수위는 이때부터 오른다. */
const ARRIVE_AT = 0.94;
const BEAD_TAIL = 0.45;
/** 모두 끝날 때 앞쪽 구부터 차례로 흘러든다 */
const DRAIN_STAGGER_MS = 130;
/** 기준 크기 구의 반지름. 목과 물방울 굵기가 구 크기를 따라간다. */
const NECK_REF_RADIUS = 44;
/** 벽을 타는 액체는 관보다 얇다 */
const RIVULET_SHARE = 0.42;

function easeOut(t: number): number {
  return 1 - (1 - t) ** 4;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeSine(t: number): number {
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function tweenAt(tween: Tween, t: number, ease: (v: number) => number = easeOut): number {
  if (tween.duration <= 0) return tween.to;
  const p = clamp01((t - tween.start) / tween.duration);
  return tween.from + (tween.to - tween.from) * ease(p);
}

function retarget(tween: Tween, to: number, t: number, duration: number, delay = 0): Tween {
  if (Math.abs(tween.to - to) < 1e-3) return tween;
  return { from: tweenAt(tween, t), to, start: t + delay, duration };
}

function still(value: number): Tween {
  return { from: value, to: value, start: 0, duration: 0 };
}

/** 레이아웃이 바뀌면(히어로 ↔ 띠) 좌표를 부드럽게 옮긴다. */
export function syncLayout(model: LiquidModel, layout: StageLayout, view: MissionView, t: number, animate: boolean) {
  const targets = deriveTargets(view, layout.edges);
  const seen = new Set<string>();
  layout.nodes.forEach((node, index) => {
    seen.add(node.id);
    const r = node.size / 2;
    const target = targets.get(node.id) ?? { level: 0, colors: [COLOR_ACCENT], slosh: 0 };
    const prev = model.pools.get(node.id);
    if (!prev) {
      model.pools.set(node.id, {
        id: node.id,
        cx: still(node.x),
        cy: still(node.y),
        r: still(r),
        level: still(target.level),
        colors: target.colors,
        slosh: still(target.slosh),
        splashes: [],
        gate: 0,
        seed: index * 1.7 + 0.4,
      });
      return;
    }
    const duration = animate ? MOVE_MS : 0;
    prev.cx = retarget(prev.cx, node.x, t, duration);
    prev.cy = retarget(prev.cy, node.y, t, duration);
    prev.r = retarget(prev.r, r, t, duration);
  });
  for (const id of model.pools.keys()) if (!seen.has(id)) model.pools.delete(id);

  const seenEdges = new Set<string>();
  for (const edge of layout.edges) {
    seenEdges.add(edge.id);
    const prev = model.edges.get(edge.id);
    const state = edgeState(edge, view);
    const color = edgeColorVar(edge, view);
    if (!prev) {
      model.edges.set(edge.id, { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, state, color, prev: edge.points, next: edge.points, moveStart: t, moveDuration: 0, flowSince: t });
      continue;
    }
    if (prev.next.some((v, i) => v !== edge.points[i])) {
      prev.prev = edgePointsAt(prev, t);
      prev.next = edge.points;
      prev.moveStart = t;
      prev.moveDuration = animate ? MOVE_MS : 0;
    }
  }
  for (const id of model.edges.keys()) if (!seenEdges.has(id)) model.edges.delete(id);
}

/**
 * 상태 변화 반영: 수위를 옮기고 물방울을 내보낸다.
 * 물방울이 도착할 때쯤 받는 쪽 수위가 오르도록 시작을 늦춘다.
 */
export function applyView(model: LiquidModel, view: MissionView, previous: MissionView | null, t: number, travel: boolean) {
  const edges = Array.from(model.edges.values());
  const targets = deriveTargets(view, edges);
  const sameMission = previous?.id === view.id;
  const completing = sameMission && view.status === 'done' && previous?.status !== 'done';
  const depths = completing ? computeDepths(view.plan?.steps ?? []) : null;

  const arriving = new Map<string, number>();
  const send = (edge: EdgeModel, color: string, radius: number, delay: number) => {
    model.beads.push({ edgeId: edge.id, color, start: t + delay, duration: BEAD_MS, radius, neck: true, until: 1, fade: false, tail: BEAD_TAIL });
    arriving.set(edge.to, Math.max(arriving.get(edge.to) ?? 0, delay + BEAD_MS * ARRIVE_AT));
  };

  if (sameMission && travel && previous) {
    for (const edge of edges) {
      const before = previous.steps[edge.from]?.status;
      const now = view.steps[edge.from]?.status;
      // 단계가 끝나면 결과가 다음 구로 건너가 합쳐진다.
      const finished = now === 'done' && before !== 'done' && before !== undefined;
      // 지휘자가 시작점 단계로 일을 나눠 준다.
      const dispatched =
        edge.from === CONDUCTOR_NODE &&
        edge.to !== ANSWER_NODE &&
        view.steps[edge.to]?.status !== 'pending' &&
        (previous.steps[edge.to]?.status ?? 'pending') === 'pending';
      // 단계 없이 바로 답할 때는 지휘자에서 결과로 바로 건너간다.
      const answering =
        edge.from === CONDUCTOR_NODE && edge.to === ANSWER_NODE && answerStatus(view) !== 'pending' && answerStatus(previous) === 'pending';
      const fromAgent = view.steps[edge.from]?.step.agent;
      const color = fromAgent ? `var(${AGENTS[fromAgent].colorVar})` : `var(${AGENTS.conductor.colorVar})`;
      if (finished || dispatched || answering) {
        send(edge, color, dispatched ? 16 : 14.5, 0);
      } else if (completing && depths && (now === 'done' || edge.from === CONDUCTOR_NODE)) {
        // 마지막 합류: 남은 액체가 관을 따라 결과 구로 흘러든다.
        send(edge, color, 12, (depths.get(edge.from) ?? 0) * DRAIN_STAGGER_MS);
      }
    }
  }

  for (const [id, target] of targets) {
    const pool = model.pools.get(id);
    if (!pool) continue;
    // 이미 건너오는 중인 물방울이 있으면 다른 이유로 다시 맞출 때도 도착을 기다린다.
    const arrival = arriving.get(id);
    if (arrival !== undefined) {
      pool.splashes.push(t + arrival);
      pool.gate = Math.max(pool.gate, t + arrival);
    }
    const rising = target.level > tweenAt(pool.level, t);
    const delay = rising ? Math.max(pool.gate - t, 0) : completing && depths ? (depths.get(id) ?? 0) * DRAIN_STAGGER_MS : 0;
    pool.level = sameMission ? retarget(pool.level, target.level, t, LEVEL_MS, delay) : still(target.level);
    pool.slosh = sameMission ? retarget(pool.slosh, target.slosh, t, 500, delay) : still(target.slosh);
    pool.colors = target.colors;
  }

  for (const edge of edges) {
    const state = edgeState(edge, view);
    if (state === 'flow' && edge.state !== 'flow') edge.flowSince = t;
    edge.state = state;
    edge.color = edgeColorVar(edge, view);
  }

  // 끝난 물방울과 오래된 출렁임을 치운다.
  model.beads = model.beads.filter((b) => t - b.start < b.duration * (1 + b.tail) + 100);
  for (const pool of model.pools.values()) pool.splashes = pool.splashes.filter((s) => t - s < 2000);
}

export interface TeamPlacement {
  id: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

const TEAM_WORKING_LEVEL = 0.52;
const TEAM_HUB_LEVEL = 0.42;

/**
 * 팀 묶음의 모델을 실제 상태에 맞춘다. 첫 항목이 지휘자다.
 * 일하는 에이전트가 없으면 액체도 관도 없고 움직일 것도 없다. 쉬는 구가 숨 쉬지 않는 이유다.
 */
export function syncTeam(model: LiquidModel, placements: TeamPlacement[], states: ReadonlyMap<string, string>, t: number, size: number) {
  const hub = placements[0];
  const first = model.pools.size === 0;
  const anyWork = states.size > 0;
  placements.forEach((p, i) => {
    const isHub = p.id === hub.id;
    const state = states.get(p.id);
    const level = isHub ? (anyWork ? TEAM_HUB_LEVEL : 0) : state ? TEAM_WORKING_LEVEL : 0;
    const slosh = state === 'running' ? 1 : 0;
    const pool = model.pools.get(p.id);
    if (!pool) {
      model.pools.set(p.id, { id: p.id, cx: still(p.x), cy: still(p.y), r: still(p.size / 2), level: still(level), colors: [p.color], slosh: still(slosh), splashes: [], gate: 0, seed: i * 1.3 });
    } else {
      pool.cx = still(p.x);
      pool.cy = still(p.y);
      pool.r = still(p.size / 2);
      pool.level = retarget(pool.level, level, t, LEVEL_MS);
      pool.slosh = retarget(pool.slosh, slosh, t, 500);
    }
    if (isHub) return;
    if (!state) {
      model.edges.delete(p.id);
      return;
    }
    const points: EdgePoints = [hub.x, hub.y, (hub.x + p.x) / 2, (hub.y + p.y) / 2, (hub.x + p.x) / 2, (hub.y + p.y) / 2, p.x, p.y];
    const edgeState: EdgeState = state === 'awaiting_approval' ? 'paused' : 'flow';
    const edge = model.edges.get(p.id);
    if (edge) {
      if (edge.state !== 'flow' && edgeState === 'flow') edge.flowSince = t;
      edge.state = edgeState;
      edge.prev = points;
      edge.next = points;
    } else {
      model.edges.set(p.id, {
        id: p.id,
        from: hub.id,
        to: p.id,
        kind: 'dispatch',
        state: edgeState,
        color: p.color,
        prev: points,
        next: points,
        moveStart: t,
        moveDuration: 0,
        // 이미 일하던 중에 화면을 열면 목이 다 자란 채로 보인다.
        flowSince: first ? t - 6000 : t,
        neckWidth: Math.max(2.6, size * 0.018),
        beadRadius: Math.max(2, size * 0.012),
      });
    }
  });
}

/** 계획을 세우는 동안 지휘자에서 방울이 맺혔다 스러진다. */
export function budFromConductor(model: LiquidModel, t: number) {
  const edge = Array.from(model.edges.values()).find((e) => e.from === CONDUCTOR_NODE);
  if (!edge) return;
  model.beads.push({ edgeId: edge.id, color: `var(${AGENTS.conductor.colorVar})`, start: t, duration: 1200, radius: 9, neck: true, until: 0.32, fade: true, tail: 0 });
}

// ─── 프레임 ──────────────────────────────────────────────────
export interface RivuletFrame {
  /** 구 좌표(반지름 1)의 path */
  d: string;
  color: string;
  width: number;
}

export interface PoolFrame {
  id: string;
  cx: number;
  cy: number;
  /** 구 바깥 반지름 (월드 좌표) */
  r: number;
  level: number;
  /** 위에서 아래로 번지는 색. 끝난 순서대로 쌓인다 */
  colors: string[];
  /** 구 좌표(반지름 1)의 액체 몸통, 수면, 수면 앞쪽 가장자리. 비어 있으면 빈 문자열 */
  body: string;
  disc: string;
  front: string;
  /** 구 왼쪽 끝과 오른쪽 끝에서 수면의 높이 (%). 아이콘이 수면에서 색을 바꾼다 */
  waterline: [number, number];
  /** 유리 안쪽 벽을 타고 수면까지 흐르는 액체 */
  rivulets: RivuletFrame[];
}

export interface EdgeFrame {
  id: string;
  d: string;
  state: EdgeState;
  color: string;
  /** 액체 목으로 그릴 굵기. 0이면 얇은 선 */
  width: number;
  /** 액체 목의 윤곽 (닫힌 path). 굵기가 0이면 빈 문자열 */
  stream: string;
  /** 보내는 구의 액체 색. 목은 이 색으로 나와 fade 구간에서 color로 바뀐다 */
  sourceColor: string;
  /** 색이 바뀌는 구간 [x1, y1, x2, y2] */
  fade: [number, number, number, number];
  /** 목이 출발지에서 얼마나 뻗었는가 (0~1) */
  reveal: number;
}

export interface BlobFrame {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface LiquidFrame {
  pools: PoolFrame[];
  edges: EdgeFrame[];
  blobs: BlobFrame[];
}

function edgePointsAt(edge: EdgeModel, t: number): EdgePoints {
  if (edge.moveDuration <= 0) return edge.next;
  const p = easeOut(clamp01((t - edge.moveStart) / edge.moveDuration));
  if (p >= 1) return edge.next;
  return edge.prev.map((v, i) => v + (edge.next[i] - v) * p) as EdgePoints;
}

function edgePath(points: EdgePoints): string {
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = points;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${cx1.toFixed(1)} ${cy1.toFixed(1)} ${cx2.toFixed(1)} ${cy2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** 유리 안쪽 벽의 반지름 (구 반지름 = 1). 렌더러의 clipPath와 같은 값이다. */
export const POOL_WALL = 0.96;
/** 수면 원반의 납작함. 살짝 위에서 내려다본 물처럼 보이게 한다. */
const DISC_RATIO = 0.2;
/** 벽으로 들어온 액체가 아래로 돌아서는 각도 (라디안) */
const RIVULET_BEND = 0.3;

function n3(v: number): string {
  return v.toFixed(3);
}

export interface PoolShape {
  body: string;
  disc: string;
  front: string;
  waterline: [number, number];
  /** 수면이 왼쪽, 오른쪽 벽에 닿는 점. 비어 있으면 null */
  contacts: [{ x: number; y: number }, { x: number; y: number }] | null;
  /** 구 좌표 x에서 수면(원반 가운데 선)의 높이 */
  surfaceAt: (x: number) => number;
}

/**
 * 수위, 기울기(라디안), 잔물결 → 구 좌표의 액체 도형. 필터를 거치지 않는 벡터라 어떤 해상도에서도 매끈하다.
 * 수면은 벽의 정확히 같은 원 위에서 시작하고 끝나며, 벽에 가까울수록 위로 말려 올라간다.
 */
export function poolShape(level: number, tilt = 0, ripple = 0): PoolShape {
  if (level <= 0.004) return { body: '', disc: '', front: '', waterline: [100, 100], contacts: null, surfaceAt: () => POOL_WALL };
  const R = POOL_WALL;
  const s = R * (1 - 2 * Math.min(level, 0.995));
  const c = Math.sqrt(Math.max(R * R - s * s, 0));
  const e = Math.min(c * DISC_RATIO, (R - Math.abs(s)) * 0.62);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const rot = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const left = rot(-c, s);
  const right = rot(c, s);
  const nx = -sin;
  const ny = cos;
  const k = (4 * e) / 3;
  const inward = c * 0.12;
  const ctrl = (from: { x: number; y: number }, dir: number, across: number, wave: number) => ({
    x: from.x + nx * (dir * k + wave) + cos * across,
    y: from.y + ny * (dir * k + wave) + sin * across,
  });
  const f1 = ctrl(left, 1, inward, ripple);
  const f2 = ctrl(right, 1, -inward, -ripple);
  const b1 = ctrl(left, -1, inward, ripple);
  const b2 = ctrl(right, -1, -inward, -ripple);
  const edge = R + 0.02;
  const body = `M${n3(left.x)} ${n3(left.y)}C${n3(b1.x)} ${n3(b1.y)} ${n3(b2.x)} ${n3(b2.y)} ${n3(right.x)} ${n3(right.y)}L${n3(edge)} ${n3(right.y)}L${n3(edge)} ${n3(edge)}L${n3(-edge)} ${n3(edge)}L${n3(-edge)} ${n3(left.y)}Z`;
  const front = `M${n3(left.x)} ${n3(left.y)}C${n3(f1.x)} ${n3(f1.y)} ${n3(f2.x)} ${n3(f2.y)} ${n3(right.x)} ${n3(right.y)}`;
  const disc = `${front}C${n3(b2.x)} ${n3(b2.y)} ${n3(b1.x)} ${n3(b1.y)} ${n3(left.x)} ${n3(left.y)}Z`;
  const center = rot(0, s);
  const slope = sin / cos;
  const surfaceAt = (x: number) => center.y + slope * (x - center.x);
  // 아이콘은 원반 뒤쪽 가장자리에서 색을 바꾼다. 수면 원반 위에 놓인 부분도 이미 액체 위에 있다.
  const percent = (y: number) => Math.round(((y - e * 0.85 + 1) / 2) * 1000) / 10;
  return { body, disc, front, waterline: [percent(surfaceAt(-1)), percent(surfaceAt(1))], contacts: [left, right], surfaceAt };
}

/**
 * 벽의 구멍에서 수면까지 유리 안쪽 벽을 타고 내려오는 액체.
 * 목이 구 한가운데서 멈추거나 아이콘을 지나가는 일이 없다. 구멍이 이미 수면 아래면 그릴 것이 없다.
 */
export function rivuletPath(shape: PoolShape, angle: number, width: number): string {
  const R = POOL_WALL;
  const inner = R - width / 2;
  const px = Math.cos(angle);
  const py = Math.sin(angle);
  if (shape.contacts && py * R >= shape.surfaceAt(px * R)) return '';
  const rightSide = px >= 0;
  const contact = shape.contacts ? shape.contacts[rightSide ? 1 : 0] : { x: 0, y: R };
  const toX = (contact.x * inner) / R;
  const toY = (contact.y * inner) / R;
  const start = `M${n3(px * 1.04)} ${n3(py * 1.04)}Q${n3(px * inner)} ${n3(py * inner)} `;
  // 벽으로 들어오는 꺾임을 둥글게 돌린 뒤 벽을 따라 내려간다. 수면이 가까우면 곡선 하나로 닿는다.
  const toAngle = Math.atan2(toY, toX);
  const remaining = Math.abs(Math.atan2(Math.sin(angle - toAngle), Math.cos(angle - toAngle)));
  if (remaining <= RIVULET_BEND) return `${start}${n3(toX)} ${n3(toY)}`;
  const bend = angle + (rightSide ? RIVULET_BEND : -RIVULET_BEND);
  return `${start}${n3(Math.cos(bend) * inner)} ${n3(Math.sin(bend) * inner)}A${n3(inner)} ${n3(inner)} 0 0 ${rightSide ? 1 : 0} ${n3(toX)} ${n3(toY)}`;
}

function splashEnergy(splashes: number[], t: number): number {
  let energy = 0;
  for (const s of splashes) {
    const age = t - s;
    if (age >= 0) energy += Math.exp(-age / 520);
  }
  return Math.min(energy, 1.6);
}

function poolFrame(pool: PoolModel, t: number, frozen: boolean): { frame: PoolFrame; shape: PoolShape } {
  const cx = tweenAt(pool.cx, t);
  const cy = tweenAt(pool.cy, t);
  const r = tweenAt(pool.r, t);
  const level = tweenAt(pool.level, t, easeInOut);
  const slosh = frozen ? 0 : tweenAt(pool.slosh, t);
  const energy = frozen ? 0 : splashEnergy(pool.splashes, t);
  // 느리게 기울고, 잔물결이 지나간다.
  const time = t / 1000;
  const tilt = (0.11 * slosh + 0.17 * energy) * Math.sin(time * 1.15 + pool.seed);
  const ripple = (0.03 * slosh + 0.07 * energy) * Math.sin(time * 2.3 + pool.seed);
  // 출렁이는 동안 수면 높이도 조금 오르내린다.
  const breathing = level + 0.012 * slosh * Math.sin(time * 1.5 + pool.seed * 2);
  const shape = poolShape(breathing, tilt, ripple);
  const colors = pool.colors.length > 0 ? pool.colors : [COLOR_ACCENT];
  return {
    shape,
    frame: { id: pool.id, cx, cy, r, level, colors, body: shape.body, disc: shape.disc, front: shape.front, waterline: shape.waterline, rivulets: [] },
  };
}

/** 베지어의 [t0, t1] 구간만 잘라 낸 새 제어점 (de Casteljau) */
function subBezier(p: EdgePoints, t0: number, t1: number): EdgePoints {
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const split = (q: EdgePoints, u: number): [EdgePoints, EdgePoints] => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
    const ax = lerp(x0, x1, u);
    const ay = lerp(y0, y1, u);
    const bx = lerp(x1, x2, u);
    const by = lerp(y1, y2, u);
    const cx = lerp(x2, x3, u);
    const cy = lerp(y2, y3, u);
    const dx = lerp(ax, bx, u);
    const dy = lerp(ay, by, u);
    const ex = lerp(bx, cx, u);
    const ey = lerp(by, cy, u);
    const fx = lerp(dx, ex, u);
    const fy = lerp(dy, ey, u);
    return [
      [x0, y0, ax, ay, dx, dy, fx, fy],
      [fx, fy, ex, ey, cx, cy, x3, y3],
    ];
  };
  const tail = split(p, t0)[1];
  return split(tail, t0 >= 1 ? 1 : (t1 - t0) / (1 - t0))[0];
}

/** 곡선이 원 밖으로 나가는 지점의 매개변수. 시작점이 원 안에 있다고 가정한다. */
function exitParam(p: EdgePoints, cx: number, cy: number, r: number, reverse: boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const at = pointOnPoints(p, reverse ? 1 - mid : mid);
    if (Math.hypot(at.x - cx, at.y - cy) < r) lo = mid;
    else hi = mid;
  }
  return reverse ? 1 - hi : hi;
}

/** 중심에서 중심으로 가는 선을 벽에서 벽까지로 자른다. 둘이 맞닿아 남는 길이가 없으면 null. */
function wallToWall(points: EdgePoints, from: PoolFrame | undefined, to: PoolFrame | undefined): EdgePoints | null {
  const t0 = from ? exitParam(points, from.cx, from.cy, from.r, false) : 0;
  const t1 = to ? exitParam(points, to.cx, to.cy, to.r, true) : 1;
  if (t1 - t0 < 0.01) return null;
  return subBezier(points, t0, t1);
}

/** 얇은 관이 끝나는 깊이 (구 반지름 = 1). 아이콘 바로 앞까지 들어가 벽의 렌즈가 꺾는 모습을 보여 주고, 중간에 끊겨 보이지 않는다. */
export const LINE_ENTRY = 0.36;

/** 얇은 관의 경로. 액체와 물방울은 벽에서 멈추고 얇은 관만 유리 뒤로 더 들어간다. */
function linePath(points: EdgePoints, from: PoolFrame | undefined, to: PoolFrame | undefined): string {
  const t0 = from ? exitParam(points, from.cx, from.cy, from.r * LINE_ENTRY, false) : 0;
  const t1 = to ? exitParam(points, to.cx, to.cy, to.r * LINE_ENTRY, true) : 1;
  return edgePath(subBezier(points, t0, t1));
}

/** 관 끝이 유리 벽을 넘어 들어가는 깊이 (구 반지름 = 1). 렌더러의 마스크 구멍과 같은 값이다. */
export const STREAM_ENTRY = 0.86;
const STREAM_SAMPLES = 44;
/** 잘록한 곳도 끈적임 필터에 지워지지 않을 만큼은 남긴다 */
const STREAM_MIN_HALF = 2.6;
/** 벽을 넘는 자리가 수면에서 얼마나 아래인가 (구 반지름 = 1). 출렁여도 드러나지 않을 만큼 */
const PORT_MARGIN = 0.14;
const PORT_TRIES = 6;
const MAX_PORT_SHIFT = 0.85;
const STREAM_FADE = 0.45;
/** 건너가는 물방울의 경로를 정할 때 보는 가장 낮은 수위 */
const BEAD_PORT_LEVEL = 0.35;
/** 작은 방울은 보내는 구의 색이 다 바뀐 뒤부터 지나간다 */
const PULSE_FROM = 0.34;

/**
 * 흐르는 관의 절반 굵기. 거리는 각 구의 벽에서 잰다.
 * 수면 아래의 벽에서 넓게 벌어져 나와 잘록해지고, 받는 벽에 닿으며 다시 벌어져 수면처럼 달라붙는다.
 * sourceWet이 false면 벽 너머에 액체가 없으므로 벌어지지 않고 뾰족하게 시작한다.
 */
export function streamHalf(fromSource: number, toTarget: number, base: number, sourceWet = true): number {
  const half = base / 2;
  const waist = Math.max(half * 0.6, Math.min(half, STREAM_MIN_HALF));
  const neck = Math.exp(-(((fromSource - base * 2.6) / (base * 1.4)) ** 2));
  const body = half + (waist - half) * neck;
  const meniscus = half * 2.1 * Math.exp(-Math.abs(toTarget) / (base * 1.1));
  if (!sourceWet) return body * clamp01(fromSource / (base * 1.6)) + meniscus;
  return body + half * 1.6 * Math.exp(-Math.abs(fromSource) / (base * 0.8)) + meniscus;
}

/**
 * 보내는 구의 수면 아래에서 나오는 경로. 곡선의 앞쪽 두 제어점을 내려 벽을 넘는 자리가 수면 아래에 오게 한다.
 * wet이 false면 그럴 수 없는 경우다: 빈 구이거나, 좁은 묶음에서 바로 위로 가는 경우.
 * minLevel은 건너가는 물방울용이다. 수위가 빠르게 빠져도 경로가 튀지 않는다.
 */
function sourceRoute(raw: EdgePoints, from: PoolFrame | undefined, shiftable: boolean, minLevel = 0): { raw: EdgePoints; wet: boolean } {
  const level = from ? Math.max(from.level, minLevel) : 0;
  if (!from || level <= 0.02) return { raw, wet: false };
  const limit = from.cy + from.r * (POOL_WALL * (1 - 2 * Math.min(level, 0.995)) + PORT_MARGIN);
  let route = raw;
  let shift = 0;
  for (let i = 0; i < PORT_TRIES; i++) {
    const exitY = pointOnPoints(route, exitParam(route, from.cx, from.cy, from.r, false)).y;
    if (exitY >= limit) return { raw: route, wet: true };
    if (!shiftable) break;
    shift = Math.min(shift + (limit - exitY) * 1.3, from.r * MAX_PORT_SHIFT);
    route = [raw[0], raw[1] + shift, raw[2], raw[3] + shift, raw[4], raw[5], raw[6], raw[7]];
  }
  return { raw, wet: false };
}

/** 벽에서 관 길이의 절반쯤까지가 색이 바뀌는 구간이다. */
function streamFade(raw: EdgePoints, from: PoolFrame | undefined, to: PoolFrame | undefined): EdgeFrame['fade'] {
  const rim0 = from ? exitParam(raw, from.cx, from.cy, from.r, false) : 0;
  const rim1 = to ? exitParam(raw, to.cx, to.cy, to.r, true) : 1;
  const a = pointOnPoints(raw, rim0);
  const b = pointOnPoints(raw, rim0 + (rim1 - rim0) * STREAM_FADE);
  return [a.x, a.y, b.x, b.y];
}

/** 중심에서 중심으로 가는 곡선을 따라 관의 윤곽을 만든다. 양 끝은 벽을 넘어 유리 안에서 뾰족하게 사라진다. */
function streamOutline(raw: EdgePoints, from: PoolFrame | undefined, to: PoolFrame | undefined, base: number, reveal: number, sourceWet: boolean): string {
  const rim0 = from ? exitParam(raw, from.cx, from.cy, from.r, false) : 0;
  const rim1 = to ? exitParam(raw, to.cx, to.cy, to.r, true) : 1;
  const in0 = from && sourceWet ? exitParam(raw, from.cx, from.cy, from.r * STREAM_ENTRY, false) : rim0;
  const in1 = to ? exitParam(raw, to.cx, to.cy, to.r * STREAM_ENTRY, true) : 1;
  if (in1 - in0 < 0.01) return '';

  const xs: number[] = [];
  const ys: number[] = [];
  const along: number[] = [];
  for (let i = 0; i <= STREAM_SAMPLES; i++) {
    const at = pointOnPoints(raw, in0 + ((in1 - in0) * i) / STREAM_SAMPLES);
    xs.push(at.x);
    ys.push(at.y);
    along.push(i === 0 ? 0 : along[i - 1] + Math.hypot(at.x - xs[i - 1], at.y - ys[i - 1]));
  }
  const lengthAt = (u: number) => {
    const f = clamp01((u - in0) / (in1 - in0)) * STREAM_SAMPLES;
    const i = Math.min(Math.floor(f), STREAM_SAMPLES - 1);
    return along[i] + (along[i + 1] - along[i]) * (f - i);
  };
  const total = along[STREAM_SAMPLES];
  const wall0 = lengthAt(rim0);
  const wall1 = lengthAt(rim1);
  const head = total * reveal;

  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= STREAM_SAMPLES && along[i] <= head; i++) {
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 1, STREAM_SAMPLES);
    const length = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) || 1;
    const nx = -(ys[b] - ys[a]) / length;
    const ny = (xs[b] - xs[a]) / length;
    const fromSource = along[i] - wall0;
    const toTarget = wall1 - along[i];
    let half = streamHalf(fromSource, toTarget, base, sourceWet);
    if (fromSource < 0 && wall0 > 0) half *= 1 - (fromSource / wall0) ** 2;
    if (toTarget < 0 && total > wall1) half *= 1 - (toTarget / (total - wall1)) ** 2;
    // 자라나는 동안의 끝은 둥글게 모은다.
    if (reveal < 1) half *= Math.sqrt(clamp01((head - along[i]) / (base * 1.5)));
    left.push(`${(xs[i] + nx * half).toFixed(1)} ${(ys[i] + ny * half).toFixed(1)}`);
    right.push(`${(xs[i] - nx * half).toFixed(1)} ${(ys[i] - ny * half).toFixed(1)}`);
  }
  if (left.length < 2) return '';
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

/** 임의의 시각의 모습. frozen이면 모션 감소: 움직이는 것 없이 수위만 보여준다. */
export function frameAt(model: LiquidModel, t: number, frozen = false): LiquidFrame {
  const clock = frozen ? Number.MAX_SAFE_INTEGER : t;
  const built = new Map<string, { frame: PoolFrame; shape: PoolShape }>();
  for (const pool of model.pools.values()) built.set(pool.id, poolFrame(pool, clock, frozen));
  const edges: EdgeFrame[] = [];
  const blobs: BlobFrame[] = [];

  const pour = (id: string, x: number, y: number, color: string, width: number) => {
    const pool = built.get(id);
    if (!pool || width <= 0) return;
    const unit = Math.min(0.12, width / pool.frame.r);
    const d = rivuletPath(pool.shape, Math.atan2(y - pool.frame.cy, x - pool.frame.cx), unit);
    if (d) pool.frame.rivulets.push({ d, color, width: unit });
  };

  for (const edge of model.edges.values()) {
    const from = built.get(edge.from)?.frame;
    const to = built.get(edge.to)?.frame;
    const flowing = edge.state === 'flow';
    const route = flowing ? sourceRoute(edgePointsAt(edge, clock), from, edge.neckWidth === undefined) : { raw: edgePointsAt(edge, clock), wet: false };
    const raw = route.raw;
    const points = wallToWall(raw, from, to);
    if (!points) continue;
    // 관의 색은 받는 쪽의 색이지만, 보내는 구에서는 그 구의 액체로 나온다.
    const sourceColor = from ? from.colors[from.colors.length - 1] : edge.color;
    const fade = flowing ? streamFade(raw, from, to) : ([0, 0, 0, 0] as EdgeFrame['fade']);
    const scale = Math.min(1.3, Math.max(0.35, Math.min(from?.r ?? NECK_REF_RADIUS, to?.r ?? NECK_REF_RADIUS) / NECK_REF_RADIUS));
    const base = edge.neckWidth ?? 6.4 * scale;
    const line = linePath(raw, from, to);
    if (!flowing) {
      edges.push({ id: edge.id, d: line, state: edge.state, color: edge.color, width: 0, stream: '', sourceColor, fade, reveal: 1 });
      continue;
    }
    if (frozen) {
      edges.push({ id: edge.id, d: line, state: edge.state, color: edge.color, width: base, stream: streamOutline(raw, from, to, base, 1, route.wet), sourceColor, fade, reveal: 1 });
      pour(edge.to, points[6], points[7], edge.color, base * RIVULET_SHARE);
      continue;
    }
    // 물방울이 건너간 뒤에야 목이 자라고, 그 다음부터 작은 방울이 일정한 간격으로 지나간다.
    const age = Math.max(0, t - edge.flowSince - NECK_DELAY_MS);
    const reveal = age > 0 ? easeOut(clamp01(age / NECK_GROW_MS)) : 0;
    const width = reveal > 0 ? base * (1 + 0.16 * Math.sin(t / 340 + points[0])) : 0;
    edges.push({ id: edge.id, d: line, state: edge.state, color: edge.color, width, stream: reveal > 0 ? streamOutline(raw, from, to, width, reveal, route.wet) : '', sourceColor, fade, reveal });
    if (reveal >= 1) {
      pour(edge.to, points[6], points[7], edge.color, base * RIVULET_SHARE);
      const count = 2;
      for (let i = 0; i < count; i++) {
        const p = ((((age - NECK_GROW_MS) / FLOW_PERIOD_MS + i / count) % 1) + 1) % 1;
        const at = pointOnPoints(points, PULSE_FROM + (0.94 - PULSE_FROM) * p);
        blobs.push({ x: at.x, y: at.y, r: (edge.beadRadius ?? 6.2 * scale) * clamp01(p / 0.14), color: edge.color });
      }
    }
  }

  if (!frozen) {
    for (const bead of model.beads) {
      const edge = model.edges.get(bead.edgeId);
      if (!edge) continue;
      const tau = (t - bead.start) / bead.duration;
      if (tau < 0 || tau >= 1 + bead.tail) continue;
      const from = built.get(edge.from)?.frame;
      const to = built.get(edge.to)?.frame;
      const points = wallToWall(sourceRoute(edgePointsAt(edge, t), from, edge.neckWidth === undefined, BEAD_PORT_LEVEL).raw, from, to);
      if (!points) continue;
      const scale = Math.min(1.3, Math.max(0.35, Math.min(from?.r ?? NECK_REF_RADIUS, to?.r ?? NECK_REF_RADIUS) / NECK_REF_RADIUS));
      const radius = bead.radius * scale;
      // 받는 쪽에서는 벽을 타고 수면까지 내려간다. 보내는 쪽은 수면 아래에서 바로 나온다.
      if (tau > 0.88 && bead.until >= 1) pour(edge.to, points[6], points[7], bead.color, radius * 0.42 * (1 - clamp01((tau - 1.1) / (bead.tail - 0.1))));
      if (tau >= 1) continue;
      const head = easeSine(tau) * bead.until;
      // 처음엔 벽에서 부풀어 오르다가 머리가 빠져나간다.
      const grow = clamp01(tau / 0.18);
      const shrink = bead.fade ? 1 - tau : 1 - 0.28 * clamp01((tau - 0.78) / 0.22);
      const at = pointOnPoints(points, head);
      blobs.push({ x: at.x, y: at.y, r: radius * grow * shrink, color: bead.color });
      if (bead.neck) {
        // 목: 출발지와 머리 사이의 액체 다리. 가운데부터 가늘어져 끊어지고, 양쪽 끝은 두 덩어리로 돌아간다.
        const taper = 1 - clamp01((tau - 0.3) / 0.34);
        if (taper > 0) {
          for (let i = 0; i <= NECK_BEADS; i++) {
            const f = i / (NECK_BEADS + 1);
            const p = pointOnPoints(points, head * f);
            const pinch = Math.abs(2 * f - 1) ** 1.6;
            blobs.push({ x: p.x, y: p.y, r: radius * (0.2 + 0.42 * taper) * (taper * (1 - pinch) + pinch), color: bead.color });
          }
        }
      }
    }
  }
  return { pools: Array.from(built.values(), (b) => b.frame), edges, blobs };
}

/** 지금 프레임을 계속 그릴 이유가 있는가. 없으면 rAF를 멈춘다. */
export function needsAnimation(model: LiquidModel, t: number): boolean {
  if (model.beads.some((b) => t - b.start < b.duration * (1 + b.tail))) return true;
  for (const pool of model.pools.values()) {
    if (pool.slosh.to > 0 || tweenAt(pool.slosh, t) > 0.001) return true;
    if (t - pool.level.start < pool.level.duration) return true;
    if (t - pool.cx.start < pool.cx.duration) return true;
    if (pool.splashes.some((s) => t - s < 1800)) return true;
  }
  for (const edge of model.edges.values()) {
    if (edge.state === 'flow') return true;
    if (t - edge.moveStart < edge.moveDuration) return true;
  }
  return false;
}

export type { StageNode };
