/**
 * 미션 스테이지 배치 계산. 실제 계획(DAG)을 받아 유리구와 필라멘트의 좌표를 만든다.
 * DOM을 모르는 순수 함수라 겹침 여부를 테스트로 검증한다.
 */
export const CONDUCTOR_NODE = '__conductor';
export const ANSWER_NODE = '__answer';

export interface StageStepInput {
  id: string;
  dependsOn: string[];
}

export type StageOrientation = 'horizontal' | 'vertical';
/** full: 두 줄 제목 + 활동, compact: 한 줄 제목 + 활동, tight: 한 줄 제목만, band: 라벨 없음 */
export type StageDensity = 'full' | 'compact' | 'tight' | 'band';
export type LabelSide = 'below' | 'left' | 'right' | 'none';

export interface StageNode {
  id: string;
  kind: 'conductor' | 'step' | 'answer';
  /** 유리구 중심 */
  x: number;
  y: number;
  /** 0 지휘자, 1.. 단계 깊이, 마지막 결과 */
  depth: number;
  /** 유리구 지름 */
  size: number;
  labelWidth: number;
  labelSide: LabelSide;
}

export type EdgePoints = [number, number, number, number, number, number, number, number];

export interface StageEdge {
  id: string;
  from: string;
  to: string;
  kind: 'dispatch' | 'dependency' | 'merge';
  /** SVG path d */
  path: string;
  /** 3차 베지어 제어점 [x1,y1,cx1,cy1,cx2,cy2,x2,y2] */
  points: EdgePoints;
}

export interface StageLayout {
  width: number;
  height: number;
  orientation: StageOrientation;
  density: StageDensity;
  nodes: StageNode[];
  edges: StageEdge[];
}

export interface StageLayoutOptions {
  steps: StageStepInput[];
  width: number;
  /** 이 높이 안에 들어가도록 밀도를 낮춘다. 그래도 안 되면 높이가 늘어난다. */
  maxHeight?: number;
  /** band: 답변을 읽는 동안 위쪽에 남는 낮은 띠 */
  mode?: 'hero' | 'band';
}

/** 이 폭보다 좁으면 위에서 아래로 흐른다. */
export const VERTICAL_BELOW = 560;
const MIN_COLUMN_GAP = 118;
const MAX_COLUMN_GAP = 420;
/** 창이 크면 구가 여기까지 자란다 */
const MAX_HUB_SIZE = 140;
const MAX_STEP_SIZE = 118;
/** 열 간격 중 구가 차지하는 비율의 상한. 나머지는 관이 보이는 자리다. */
const SIZE_TO_GAP = 0.46;
/** 남는 높이의 이만큼을 병렬 갈래를 벌리는 데 쓴다 */
const SPREAD = 0.82;
/** 갈래를 벌려도 관이 가파른 벽처럼 되지 않게 하는 상한 (열 간격 대비) */
const MAX_PITCH_TO_GAP = 1.15;
const MAX_SAG = 20;

interface DensitySpec {
  stepSize: number;
  hubSize: number;
  /** 구 아래 라벨 영역 높이 */
  label: number;
  /** 줄 사이 여백 */
  gap: number;
}

const DENSITY: Record<'full' | 'compact' | 'tight', DensitySpec> = {
  full: { stepSize: 80, hubSize: 96, label: 62, gap: 16 },
  compact: { stepSize: 66, hubSize: 80, label: 42, gap: 10 },
  tight: { stepSize: 52, hubSize: 64, label: 20, gap: 6 },
};

/** 라벨이 구 아래로 내려가는 거리 */
export const LABEL_GAP = 7;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
const BAND_SIZE = 32;
const BAND_HUB = 38;
/** 띠의 결과 구: 모두가 흘러든 곳이라 눈에 띄게 크다 */
const BAND_RESULT = 64;
const BAND_ROW = 38;
const BAND_MAX_HEIGHT = 92;
const BAND_PAD = 6;
const BAND_MIN_GAP = 20;
const BAND_MAX_GAP = 160;

/** 라벨 묶음 높이. 겹침 검사와 렌더링이 같은 값을 쓴다. */
export function labelHeight(density: StageDensity): number {
  if (density === 'band') return 0;
  return DENSITY[density].label;
}

/** 각 단계의 깊이 = 시작점에서 가장 긴 경로. 없는 의존성은 무시하고, 순환이 있어도 멈춘다. */
export function computeDepths(steps: StageStepInput[]): Map<string, number> {
  const known = new Map(steps.map((s) => [s.id, s]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (id: string): number => {
    const memo = depths.get(id);
    if (memo !== undefined) return memo;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const step = known.get(id);
    let depth = 1;
    for (const dep of step?.dependsOn ?? []) {
      if (known.has(dep)) depth = Math.max(depth, visit(dep) + 1);
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };

  steps.forEach((s) => visit(s.id));
  return depths;
}

function groupByDepth(steps: StageStepInput[], depths: Map<string, number>): StageStepInput[][] {
  const maxDepth = steps.reduce((m, s) => Math.max(m, depths.get(s.id) ?? 1), 0);
  const groups: StageStepInput[][] = Array.from({ length: maxDepth }, () => []);
  for (const step of steps) groups[(depths.get(step.id) ?? 1) - 1].push(step);
  return groups;
}

function rowHeight(spec: DensitySpec): number {
  return spec.stepSize + LABEL_GAP + spec.label + spec.gap;
}

/** 줄이 많은 열은 두 갈래로 엇갈려 놓아 세로 공간을 절반만 쓴다. */
function columnHeight(rows: number, spec: DensitySpec, staggered: boolean): number {
  const row = rowHeight(spec);
  if (rows <= 1) return Math.max(spec.hubSize, spec.stepSize) + LABEL_GAP + spec.label;
  const pitch = staggered ? row / 2 : row;
  return (rows - 1) * pitch + row - spec.gap;
}

function cubic(points: EdgePoints): string {
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = points;
  return `M ${round(x1)} ${round(y1)} C ${round(cx1)} ${round(cy1)}, ${round(cx2)} ${round(cy2)}, ${round(x2)} ${round(y2)}`;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function buildEdges(steps: StageStepInput[], nodes: Map<string, StageNode>, orientation: StageOrientation, density: StageDensity = 'band'): StageEdge[] {
  const known = new Set(steps.map((s) => s.id));
  const hasDependents = new Set<string>();
  const edges: StageEdge[] = [];
  const all = Array.from(nodes.values());

  const connect = (from: string, to: string, kind: StageEdge['kind']) => {
    const a = nodes.get(from);
    const b = nodes.get(to);
    if (!a || !b) return;
    let points: EdgePoints;
    if (orientation === 'horizontal') {
      const mid = (a.x + b.x) / 2;
      points = [a.x, a.y, mid, a.y, mid, b.y, b.x, b.y];
      // 곧은 관은 자기 무게로 살짝 처진다. 자로 그은 막대처럼 보이지 않게 한다.
      if (Math.abs(a.y - b.y) < 1) {
        const third = (b.x - a.x) / 3;
        const sag = Math.min(MAX_SAG, (b.x - a.x) * 0.05);
        points = [a.x, a.y, a.x + third, a.y + sag, b.x - third, b.y + sag, b.x, b.y];
      }
      // 사이 열을 건너뛰는 선이 다른 구와 그 라벨을 뚫고 지나가지 않도록 휘어 준다.
      const blockers = all.filter((n) => n.depth > a.depth && n.depth < b.depth && n.id !== from && n.id !== to);
      if (blockers.length > 0) {
        const clearance = Math.max(...blockers.map((n) => n.size)) * 0.5 + 16;
        const under = density === 'band' ? 0 : LABEL_GAP + labelHeight(density);
        const minY = Math.min(...blockers.map((n) => n.y)) - clearance;
        const maxY = Math.max(...blockers.map((n) => n.y)) + clearance + under;
        const lane = Math.abs(minY - a.y) <= Math.abs(maxY - a.y) ? minY : maxY;
        // 3차 베지어의 중간 지점이 lane에 닿으려면 제어점이 그만큼 더 멀리 있어야 한다.
        const pull = (lane - ((a.y + b.y) / 2) * 0.25) / 0.75;
        points = [a.x, a.y, a.x + (b.x - a.x) * 0.25, pull, a.x + (b.x - a.x) * 0.75, pull, b.x, b.y];
      }
    } else {
      const mid = (a.y + b.y) / 2;
      points = [a.x, a.y, a.x, mid, b.x, mid, b.x, b.y];
    }
    edges.push({ id: `${from}->${to}`, from, to, kind, path: cubic(points), points });
  };

  for (const step of steps) {
    const deps = step.dependsOn.filter((d) => known.has(d) && d !== step.id);
    if (deps.length === 0) connect(CONDUCTOR_NODE, step.id, 'dispatch');
    for (const dep of deps) {
      hasDependents.add(dep);
      connect(dep, step.id, 'dependency');
    }
  }
  const leaves = steps.filter((s) => !hasDependents.has(s.id));
  if (leaves.length === 0) connect(CONDUCTOR_NODE, ANSWER_NODE, 'merge');
  for (const leaf of leaves) connect(leaf.id, ANSWER_NODE, 'merge');
  return edges;
}

/** 부모들의 평균 높이 순으로 정렬해 선이 덜 교차하게 한다. */
function orderColumn(group: StageStepInput[], placed: Map<string, number>, fallback: number): StageStepInput[] {
  return group
    .map((step, order) => {
      const parents = step.dependsOn.map((d) => placed.get(d)).filter((y): y is number => y !== undefined);
      const weight = parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : fallback;
      return { step, order, weight };
    })
    .sort((a, b) => a.weight - b.weight || a.order - b.order)
    .map((entry) => entry.step);
}

function layoutHorizontal(steps: StageStepInput[], width: number, maxHeight: number): StageLayout {
  const depths = computeDepths(steps);
  const groups = groupByDepth(steps, depths);
  const columns = groups.length + 2;
  const maxRows = groups.reduce((m, g) => Math.max(m, g.length), 1);

  const fits = (d: 'full' | 'compact' | 'tight', stagger: boolean) => PAD_TOP + columnHeight(maxRows, DENSITY[d], stagger) + PAD_BOTTOM <= maxHeight;

  // 양 끝 라벨이 잘리지 않을 여백을 두고 열 간격을 정한다. 넓은 화면에서 선이 늘어지지 않게 상한을 둔다.
  const sidePad = 94;
  const gapFit = (width - sidePad * 2) / (columns - 1);
  const columnGap = Math.min(MAX_COLUMN_GAP, Math.max(MIN_COLUMN_GAP, gapFit));
  const labelWidth = Math.min(columnGap - 10, 182);
  const canStagger = columnGap >= 200;

  let density: 'full' | 'compact' | 'tight' = 'tight';
  let staggered = false;
  const order: Array<['full' | 'compact' | 'tight', boolean]> = [
    ['full', false],
    ['compact', false],
    ['compact', true],
    ['tight', false],
    ['tight', true],
  ];
  for (const [d, stagger] of order) {
    if (stagger && !canStagger) continue;
    if (fits(d, stagger)) {
      density = d;
      staggered = stagger;
      break;
    }
  }
  // 어떤 조합도 안 들어가면 엇갈린 tight로 두고 높이를 늘린다 (칼럼이 스크롤된다).
  if (!fits(density, staggered) && canStagger) staggered = true;
  const spec = DENSITY[density];

  // 줄 수와 라벨을 빼고 남는 높이, 열 간격 안에서 구를 키운다.
  const usable = maxHeight - PAD_TOP - PAD_BOTTOM;
  let stepSize = spec.stepSize;
  let hubSize = spec.hubSize;
  if (density === 'full') {
    const byHeight = (usable - maxRows * (LABEL_GAP + spec.label) - (maxRows - 1) * spec.gap) / maxRows;
    stepSize = Math.round(Math.max(spec.stepSize, Math.min(MAX_STEP_SIZE, columnGap * SIZE_TO_GAP, byHeight)));
    hubSize = Math.round(Math.max(spec.hubSize, Math.min(MAX_HUB_SIZE, stepSize * 1.19, usable - LABEL_GAP - spec.label)));
  }
  const grown: DensitySpec = { ...spec, stepSize, hubSize };

  const contentWidth = columnGap * (columns - 1) + sidePad * 2;
  const finalWidth = Math.max(width, contentWidth);
  const left = (finalWidth - columnGap * (columns - 1)) / 2;

  const needed = PAD_TOP + columnHeight(maxRows, grown, staggered) + PAD_BOTTOM;
  const height = Math.max(needed, maxHeight);
  // 구 + 라벨 묶음을 세로 가운데 놓기 위한 구 중심선.
  const centerY = (PAD_TOP + height - PAD_BOTTOM) / 2 - (LABEL_GAP + spec.label) / 2;

  const nodes = new Map<string, StageNode>();
  nodes.set(CONDUCTOR_NODE, { id: CONDUCTOR_NODE, kind: 'conductor', x: left, y: centerY, depth: 0, size: hubSize, labelWidth, labelSide: 'below' });

  const placed = new Map<string, number>();
  const row = rowHeight(grown);
  // 병렬 갈래는 창의 높이를 따라 벌어진다. 위아래 빈 공간이 곧 관의 길이가 된다.
  const maxSpread = usable - stepSize - LABEL_GAP - spec.label;
  const pitchFor = (rows: number) => {
    if (rows <= 1) return row;
    const room = maxSpread / (rows - 1);
    if (room <= row) return row;
    return Math.max(row, Math.min(row + (room - row) * SPREAD, columnGap * MAX_PITCH_TO_GAP));
  };
  groups.forEach((group, index) => {
    const ordered = orderColumn(group, placed, centerY);
    const rows = ordered.length;
    const stagger = staggered && rows > 2;
    const pitch = stagger ? row / 2 : pitchFor(rows);
    const shift = Math.min(columnGap * 0.27, labelWidth / 2 + 4);
    ordered.forEach((step, i) => {
      const y = centerY + (i - (rows - 1) / 2) * pitch;
      placed.set(step.id, y);
      nodes.set(step.id, {
        id: step.id,
        kind: 'step',
        x: left + columnGap * (index + 1) + (stagger ? (i % 2 === 0 ? -shift : shift) : 0),
        y,
        depth: index + 1,
        size: stepSize,
        labelWidth: stagger ? Math.min(labelWidth, shift * 2 - 6) : labelWidth,
        labelSide: 'below',
      });
    });
  });

  nodes.set(ANSWER_NODE, { id: ANSWER_NODE, kind: 'answer', x: left + columnGap * (columns - 1), y: centerY, depth: columns - 1, size: hubSize, labelWidth, labelSide: 'below' });

  return {
    width: finalWidth,
    height,
    orientation: 'horizontal',
    density,
    nodes: Array.from(nodes.values()),
    edges: buildEdges(steps, nodes, 'horizontal', density),
  };
}

/**
 * 좁은 화면: 위에서 아래로 흐른다. 한 깊이에 둘 이상이면 좌우 두 갈래로 놓고,
 * 라벨은 필라멘트 반대쪽(바깥쪽)에 붙인다. 선이 글자를 지나가지 않는다.
 */
function layoutVertical(steps: StageStepInput[], width: number, maxHeight: number): StageLayout {
  const depths = computeDepths(steps);
  const groups = groupByDepth(steps, depths);
  // 양쪽 갈래의 라벨 자리를 먼저 지키고 남는 만큼만 키운다.
  const size = Math.max(58, Math.round(Math.min(72, width / 2 - 108, width * 0.19)));
  const hub = Math.round(size * 1.16);
  const labelMin = 92;
  const rows = groups.reduce((n, g) => n + Math.ceil(g.length / 2), 0);
  const fixed = PAD_TOP + PAD_BOTTOM + hub * 2 + rows * size;
  const rowGap = Math.round(Math.min(48, Math.max(24, (maxHeight - fixed) / (rows + 1))));

  const center = width / 2;
  // 왼쪽 라벨이 화면 안에 들어오는 만큼만 벌린다. 두 구가 겹치지 않는 것이 우선이다.
  const laneOffset = Math.max(size / 2 + 6, Math.min(width * 0.2, center - labelMin - 10 - size / 2));
  const leftLane = center - laneOffset;
  const rightLane = center + laneOffset;
  const sideRoom = (x: number, side: 'left' | 'right', sphere = size) =>
    Math.max(labelMin, side === 'left' ? x - sphere / 2 - 10 : width - x - sphere / 2 - 10);

  const nodes = new Map<string, StageNode>();
  let y = PAD_TOP + hub / 2;
  const hubLabel = sideRoom(center, 'right', hub);

  nodes.set(CONDUCTOR_NODE, { id: CONDUCTOR_NODE, kind: 'conductor', x: center, y, depth: 0, size: hub, labelWidth: hubLabel, labelSide: 'right' });
  y += hub / 2 + rowGap + size / 2;

  groups.forEach((group, index) => {
    for (let start = 0; start < group.length; start += 2) {
      const slice = group.slice(start, start + 2);
      if (slice.length === 1) {
        nodes.set(slice[0].id, { id: slice[0].id, kind: 'step', x: center, y, depth: index + 1, size, labelWidth: sideRoom(center, 'right'), labelSide: 'right' });
      } else {
        nodes.set(slice[0].id, { id: slice[0].id, kind: 'step', x: leftLane, y, depth: index + 1, size, labelWidth: sideRoom(leftLane, 'left'), labelSide: 'left' });
        nodes.set(slice[1].id, { id: slice[1].id, kind: 'step', x: rightLane, y, depth: index + 1, size, labelWidth: sideRoom(rightLane, 'right'), labelSide: 'right' });
      }
      y += size + rowGap;
    }
  });

  y += (hub - size) / 2;
  nodes.set(ANSWER_NODE, { id: ANSWER_NODE, kind: 'answer', x: center, y, depth: groups.length + 1, size: hub, labelWidth: hubLabel, labelSide: 'right' });

  return {
    width,
    height: y + hub / 2 + PAD_BOTTOM,
    orientation: 'vertical',
    density: 'full',
    nodes: Array.from(nodes.values()),
    edges: buildEdges(steps, nodes, 'vertical'),
  };
}

/**
 * 답변을 읽는 동안의 낮은 띠: 라벨 없는 작은 DAG. 병렬 단계는 위아래로 벌어져 갈래가 그대로 읽히고,
 * 모두가 흘러든 결과 구만 크다. 한 열이 높이에 안 들어가면 옆으로 두세 줄로 나눠 겹치지 않게 한다.
 */
function layoutBand(steps: StageStepInput[], width: number): StageLayout {
  const depths = computeDepths(steps);
  const groups = groupByDepth(steps, depths);
  const maxRows = groups.reduce((m, g) => Math.max(m, g.length), 1);
  const stacked = Math.min(maxRows, 3);
  const height = Math.min(BAND_MAX_HEIGHT, Math.max(BAND_RESULT, BAND_SIZE + (stacked - 1) * BAND_ROW) + BAND_PAD * 2);
  const centerY = height / 2;
  const room = height - BAND_PAD * 2 - BAND_SIZE;

  // 열마다 필요한 폭과 세로 간격
  const plans = groups.map((group) => {
    const n = group.length;
    if (n <= 1) return { pitch: 0, lanes: 1 };
    const pitch = Math.min(BAND_ROW, room / (n - 1));
    let lanes = 1;
    while (lanes * pitch < BAND_SIZE + 2) lanes++;
    return { pitch, lanes };
  });
  const laneStep = BAND_SIZE + 4;
  const widths = plans.map((plan) => BAND_SIZE + (plan.lanes - 1) * laneStep);
  const total = BAND_HUB + BAND_RESULT + widths.reduce((a, b) => a + b, 0);
  const gaps = groups.length + 1;
  const gap = Math.max(BAND_MIN_GAP, Math.min(BAND_MAX_GAP, (width - total) / gaps));
  const contentWidth = total + gap * gaps;
  const finalWidth = Math.max(width, contentWidth);
  // 지휘자가 읽는 칸의 왼쪽 선에서 시작한다.
  let cursor = 0;

  const nodes = new Map<string, StageNode>();
  nodes.set(CONDUCTOR_NODE, { id: CONDUCTOR_NODE, kind: 'conductor', x: cursor + BAND_HUB / 2, y: centerY, depth: 0, size: BAND_HUB, labelWidth: 0, labelSide: 'none' });
  cursor += BAND_HUB + gap;

  const placed = new Map<string, number>();
  groups.forEach((group, index) => {
    const ordered = orderColumn(group, placed, centerY);
    const { pitch, lanes } = plans[index];
    const start = centerY - ((ordered.length - 1) * pitch) / 2;
    ordered.forEach((step, i) => {
      const lane = i % lanes;
      const y = ordered.length > 1 ? start + i * pitch : centerY;
      placed.set(step.id, y);
      nodes.set(step.id, { id: step.id, kind: 'step', x: cursor + BAND_SIZE / 2 + lane * laneStep, y, depth: index + 1, size: BAND_SIZE, labelWidth: 0, labelSide: 'none' });
    });
    cursor += widths[index] + gap;
  });

  nodes.set(ANSWER_NODE, { id: ANSWER_NODE, kind: 'answer', x: cursor + BAND_RESULT / 2, y: centerY, depth: groups.length + 1, size: BAND_RESULT, labelWidth: 0, labelSide: 'none' });

  return {
    width: finalWidth,
    height,
    orientation: 'horizontal',
    density: 'band',
    nodes: Array.from(nodes.values()),
    edges: buildEdges(steps, nodes, 'horizontal'),
  };
}

export function layoutStage({ steps, width, maxHeight = 460, mode = 'hero' }: StageLayoutOptions): StageLayout {
  if (mode === 'band') return layoutBand(steps, width);
  return width < VERTICAL_BELOW ? layoutVertical(steps, width, maxHeight) : layoutHorizontal(steps, width, maxHeight);
}

export const APPROVAL_CARD = { width: 348, height: 214 };

/** 기다리는 구 근처에 승인 카드를 놓는다. 스테이지 안에 머물고 구를 가리지 않는다. */
export interface ApprovalAnchor {
  x: number;
  /** 카드 높이가 기본값일 때의 위쪽 좌표 */
  y: number;
  width: number;
  /** above면 아래쪽 변을 고정해 내용이 길어져도 구를 덮지 않고 위로 자란다 */
  placement: 'above' | 'below' | 'side';
  /** 스테이지 밖으로 나가지 않는 최대 높이 */
  maxHeight: number;
  /** placement가 above일 때 스테이지 아래에서 카드 아래쪽 변까지의 거리 */
  bottom: number;
}

export function approvalAnchor(node: Pick<StageNode, 'x' | 'y' | 'size'>, layout: Pick<StageLayout, 'width' | 'height'>): ApprovalAnchor {
  const { width, height } = APPROVAL_CARD;
  const gap = 14;
  const x = Math.min(Math.max(node.x - width / 2, 8), Math.max(layout.width - width - 8, 8));
  const above = node.y - node.size / 2 - gap - height;
  if (above >= 0) {
    const edge = node.y - node.size / 2 - gap;
    return { x, y: above, width, placement: 'above', maxHeight: edge, bottom: layout.height - edge };
  }
  // 위가 비좁으면 라벨 아래로. 그래도 안 되면 구 옆으로 비켜 선다.
  const below = node.y + node.size / 2 + 72;
  if (below + height <= layout.height) return { x, y: below, width, placement: 'below', maxHeight: layout.height - below, bottom: 0 };
  const side = node.x + node.size / 2 + gap + width <= layout.width ? node.x + node.size / 2 + gap : node.x - node.size / 2 - gap - width;
  const y = Math.max(Math.min(node.y - height / 2, layout.height - height), 0);
  return { x: Math.max(side, 8), y, width, placement: 'side', maxHeight: layout.height - y, bottom: 0 };
}

/** 베지어 위의 점. 물방울 경로 계산과 충돌 검사에 쓴다. */
export function pointOnPoints(points: EdgePoints, t: number): { x: number; y: number } {
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = points;
  const u = 1 - t;
  return {
    x: u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2,
    y: u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2,
  };
}

export function pointOnEdge(edge: Pick<StageEdge, 'points'>, t: number): { x: number; y: number } {
  return pointOnPoints(edge.points, t);
}
