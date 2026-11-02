import { describe, expect, it } from 'vitest';
import { ANSWER_NODE, CONDUCTOR_NODE, layoutStage, type StageLayout } from '@/components/mission/layout';
import { applyView, BEAD_MS, deriveTargets, emptyModel, frameAt, LINE_ENTRY, mergedColor, needsAnimation, POOL_WALL, poolShape, rivuletPath, stepPool, STREAM_ENTRY, streamHalf, syncLayout, syncTeam, type LiquidFrame, type LiquidModel, type TeamPlacement } from '@/components/mission/liquid';
import type { MissionView, PlanStep, StepStatus, StepView } from '@/lib/contracts';
import { emptyUsage } from '@/lib/missions/reducer';

const PLAN: PlanStep[] = [
  { id: 's1', agent: 'researcher', title: 'a', task: 't', dependsOn: [] },
  { id: 's2', agent: 'analyst', title: 'b', task: 't', dependsOn: ['s1'] },
];

function stepView(step: PlanStep, status: StepStatus, finishedAt?: number): StepView {
  return { step, status, thinking: '', text: '', activity: '', toolCalls: [], usage: emptyUsage(), tainted: false, finishedAt };
}

function view(statuses: Record<string, StepStatus>, patch: Partial<MissionView> = {}): MissionView {
  return {
    id: 'm',
    goal: 'g',
    title: 't',
    status: 'running',
    mode: 'demo',
    plan: { title: 't', route: 'team', steps: PLAN },
    steps: Object.fromEntries(PLAN.map((s, i) => [s.id, stepView(s, statuses[s.id] ?? 'pending', statuses[s.id] === 'done' ? i + 1 : undefined)])),
    stepOrder: PLAN.map((s) => s.id),
    conductorThinking: '',
    answer: '',
    turns: [],
    approvals: [],
    artifacts: [],
    usage: emptyUsage(),
    budgetUsd: 2,
    turnStartCostUsd: 0,
    createdAt: 0,
    turnStartedAt: 0,
    updatedAt: 0,
    seq: 0,
    ...patch,
  };
}

function setup(v: MissionView): { model: LiquidModel; layout: StageLayout } {
  const layout = layoutStage({ steps: v.plan?.steps ?? [], width: 1000, maxHeight: 500 });
  const model = emptyModel();
  syncLayout(model, layout, v, 0, false);
  applyView(model, v, null, 0, false);
  return { model, layout };
}

/** 프레임 안에서 큰 물방울(머리)의 수 */
function heads(frame: LiquidFrame, min = 10): number {
  return frame.blobs.filter((b) => b.r >= min).length;
}

describe('stepPool maps status to liquid one to one', () => {
  const color = 'var(--c)';
  it('leaves pending glass empty until something arrives', () => {
    expect(stepPool('pending', color, 0, 0).level).toBe(0);
    expect(stepPool('pending', color, 0, 1).level).toBeGreaterThan(0);
  });
  it('lets running liquid slosh and rise with real tool use', () => {
    const a = stepPool('running', color, 0, 0);
    const b = stepPool('running', color, 3, 0);
    expect(a.slosh).toBe(1);
    expect(b.level).toBeGreaterThan(a.level);
  });
  it('holds liquid perfectly still while waiting for approval', () => {
    const p = stepPool('awaiting_approval', color, 1, 0);
    expect(p.slosh).toBe(0);
    expect(p.level).toBeGreaterThan(0.4);
  });
  it('fills on done, drains red on failure, empties on skip', () => {
    expect(stepPool('done', color, 0, 0).level).toBeGreaterThan(0.6);
    const failed = stepPool('failed', color, 0, 0);
    expect(failed.level).toBeLessThan(0.2);
    expect(failed.colors).toEqual(['var(--danger)']);
    expect(stepPool('skipped', color, 0, 0).level).toBe(0);
  });
});

describe('deriveTargets', () => {
  it('drains the conductor as it hands out work', () => {
    const edges = [{ from: CONDUCTOR_NODE, to: 's1' }, { from: 's1', to: 's2' }];
    const before = deriveTargets(view({}), edges).get(CONDUCTOR_NODE)?.level ?? 0;
    const during = deriveTargets(view({ s1: 'running' }), edges).get(CONDUCTOR_NODE)?.level ?? 0;
    const after = deriveTargets(view({ s1: 'done', s2: 'running' }), edges).get(CONDUCTOR_NODE)?.level ?? 0;
    expect(before).toBeGreaterThan(during);
    expect(during).toBeGreaterThan(after);
  });

  it('keeps the result dry until its own incoming pipe delivers', () => {
    const edges = [{ from: 's2', to: ANSWER_NODE }];
    expect(deriveTargets(view({}), edges).get(ANSWER_NODE)?.level).toBe(0);
    // s1이 끝나도 결과로 들어오는 관(s2 -> 결과)은 아직 말라 있다.
    expect(deriveTargets(view({ s1: 'done', s2: 'running' }), edges).get(ANSWER_NODE)?.level).toBe(0);
    expect(deriveTargets(view({ s1: 'done', s2: 'done' }), edges).get(ANSWER_NODE)?.level).toBeGreaterThan(0);
  });

  it('keeps every contributor, in finish order, inside one merged liquid once the result is full', () => {
    const edges = [{ from: 's2', to: ANSWER_NODE }];
    const full = deriveTargets(view({ s1: 'done', s2: 'done' }, { status: 'done' }), edges).get(ANSWER_NODE);
    expect(full?.level).toBeGreaterThan(0.6);
    expect(full?.colors).toEqual(['var(--agent-researcher)', 'var(--agent-analyst)'].map(mergedColor));
  });
});

describe('completion', () => {
  it('drains every connected sphere into a full result when the mission finishes', () => {
    const before = view({ s1: 'done', s2: 'done' }, { status: 'synthesizing' });
    const { model } = setup(before);
    const after = view({ s1: 'done', s2: 'done' }, { status: 'done' });
    applyView(model, after, before, 0, true);
    // 관을 따라 물방울이 흘러간다.
    expect(model.beads.some((b) => b.edgeId === `s2->${ANSWER_NODE}`)).toBe(true);
    const level = (id: string) => frameAt(model, BEAD_MS * 5).pools.find((p) => p.id === id)?.level ?? 0;
    expect(level('s1')).toBeLessThan(0.1);
    expect(level('s2')).toBeLessThan(0.1);
    expect(level(CONDUCTOR_NODE)).toBeLessThan(0.1);
    expect(level(ANSWER_NODE)).toBeGreaterThan(0.8);
  });
});

describe('frameAt is a pure function of the model and time', () => {
  it('returns identical frames for the same t', () => {
    const before = view({});
    const { model } = setup(before);
    applyView(model, view({ s1: 'running' }), before, 1000, true);
    expect(frameAt(model, 1300)).toEqual(frameAt(model, 1300));
  });

  it('necks, snaps and fuses over the travel of a dispatched bead', () => {
    const before = view({});
    const { model } = setup(before);
    applyView(model, view({ s1: 'running' }), before, 1000, true);
    const start = model.beads[0];
    expect(start.edgeId).toBe(`${CONDUCTOR_NODE}->s1`);
    expect(start.radius).toBeGreaterThanOrEqual(12);
    expect(start.radius).toBeLessThanOrEqual(18);
    expect(BEAD_MS).toBeGreaterThanOrEqual(800);

    // 초반: 머리와 이어진 목(구슬 줄)이 있다.
    const necking = frameAt(model, 1000 + BEAD_MS * 0.42);
    const neckBlobs = necking.blobs.filter((b) => b.r > 1 && b.r < start.radius * 0.7);
    expect(heads(necking)).toBeGreaterThanOrEqual(1);
    expect(neckBlobs.length).toBeGreaterThanOrEqual(8);

    // 목은 가운데가 가장 가늘다: 거기서 먼저 끊어진다.
    const radii = neckBlobs.map((b) => b.r);
    expect(Math.min(...radii)).toBeLessThan(radii[0]);
    expect(Math.min(...radii)).toBeLessThan(radii[radii.length - 1]);

    // 끊어진 뒤: 머리만 남고 사이에는 아무것도 없다.
    const flying = frameAt(model, 1000 + BEAD_MS * 0.7);
    expect(heads(flying)).toBeGreaterThanOrEqual(1);
    expect(flying.blobs.filter((b) => b.r > 0 && b.r < start.radius * 0.7).length).toBe(0);

    // 끝나면 머리가 사라진다.
    expect(heads(frameAt(model, 1000 + BEAD_MS + 1), 10)).toBe(0);
  });

  it('moves the head monotonically from source to target', () => {
    const before = view({});
    const { model, layout } = setup(before);
    applyView(model, view({ s1: 'running' }), before, 0, true);
    const source = layout.nodes.find((n) => n.id === CONDUCTOR_NODE);
    const xs = [0.3, 0.5, 0.7, 0.9].map((p) => {
      const biggest = frameAt(model, BEAD_MS * p).blobs.reduce((a, b) => (b.r > a.r ? b : a));
      return biggest.x;
    });
    expect(xs[0]).toBeGreaterThan(source?.x ?? 0);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('raises the receiving level only as the bead arrives', () => {
    const before = view({});
    const { model } = setup(before);
    applyView(model, view({ s1: 'running' }), before, 0, true);
    const level = (t: number) => frameAt(model, t).pools.find((p) => p.id === 's1')?.level ?? 0;
    expect(level(BEAD_MS * 0.4)).toBe(0);
    expect(level(BEAD_MS * 3)).toBeGreaterThan(0.4);
  });

  it('swells the next sphere when a finished step sends its bead on', () => {
    const before = view({ s1: 'running' });
    const { model } = setup(before);
    applyView(model, view({ s1: 'done', s2: 'running' }), before, 0, true);
    expect(model.beads.some((b) => b.edgeId === 's1->s2')).toBe(true);
    expect(model.pools.get('s2')?.splashes.length).toBeGreaterThan(0);
  });

  it('does not raise the result before the bead reaches its wall', () => {
    const before = view({ s1: 'done', s2: 'running' });
    const { model } = setup(before);
    applyView(model, view({ s1: 'done', s2: 'done' }), before, 0, true);
    const level = (t: number) => frameAt(model, t).pools.find((p) => p.id === ANSWER_NODE)?.level ?? 0;
    expect(level(BEAD_MS * 0.8)).toBe(0);
    expect(level(BEAD_MS * 3)).toBeGreaterThan(0.3);
  });

  it('keeps a later retarget from filling ahead of a bead still in the air', () => {
    const before = view({ s1: 'done', s2: 'running' });
    const { model } = setup(before);
    const done = view({ s1: 'done', s2: 'done' });
    applyView(model, done, before, 0, true);
    // 물방울이 건너오는 중에 합치기가 시작되어도 도착 전에는 오르지 않는다.
    applyView(model, { ...done, status: 'synthesizing' }, done, BEAD_MS * 0.3, true);
    const level = (t: number) => frameAt(model, t).pools.find((p) => p.id === ANSWER_NODE)?.level ?? 0;
    expect(level(BEAD_MS * 0.8)).toBe(0);
    expect(level(BEAD_MS * 3)).toBeGreaterThan(0.4);
  });

  it('ends every thin pipe just inside the glass, short of the icon in the middle', () => {
    const v = view({ s1: 'running' });
    const { model } = setup(v);
    const frame = frameAt(model, BEAD_MS * 4);
    const near = (p: { cx: number; cy: number; r: number }, x: number, y: number) => Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r * LINE_ENTRY);
    for (const edge of frame.edges) {
      const nums = (edge.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const distances = frame.pools.map((p) => near(p, nums[0], nums[1]));
      expect(Math.min(...distances), `${edge.id} start`).toBeLessThan(0.6);
      const ends = frame.pools.map((p) => near(p, nums[nums.length - 2], nums[nums.length - 1]));
      expect(Math.min(...ends), `${edge.id} end`).toBeLessThan(0.6);
    }
  });

  it('thickens filaments only while they flow', () => {
    const before = view({});
    const { model } = setup(before);
    const idle = frameAt(model, 0).edges.find((e) => e.id.endsWith('->s1'));
    expect(idle?.width).toBe(0);
    applyView(model, view({ s1: 'running' }), before, 0, true);
    // 물방울이 건너가는 동안은 목이 없다. 분리되는 순간이 보여야 한다.
    expect(frameAt(model, BEAD_MS * 0.4).edges.find((e) => e.id.endsWith('->s1'))?.width).toBe(0);
    const flowing = frameAt(model, BEAD_MS * 3).edges.find((e) => e.id.endsWith('->s1'));
    expect(flowing?.width).toBeGreaterThan(5);
    expect(flowing?.reveal).toBe(1);
  });

  it('shows liquid levels but nothing travelling when frozen for reduced motion', () => {
    const before = view({ s1: 'running' });
    const { model } = setup(before);
    applyView(model, view({ s1: 'done', s2: 'running' }), before, 0, false);
    expect(model.beads).toHaveLength(0);
    const frame = frameAt(model, 5000, true);
    expect(frame.blobs).toHaveLength(0);
    expect(frame.pools.find((p) => p.id === 's1')?.level).toBeGreaterThan(0.6);
    // 모션 감소에서는 시각이 달라도 모습이 같다.
    expect(frameAt(model, 9000, true)).toEqual(frame);
  });

  it('stops asking for frames when nothing moves', () => {
    const done = view({ s1: 'done', s2: 'done' }, { status: 'done' });
    const { model } = setup(done);
    expect(needsAnimation(model, 10_000)).toBe(false);
    const running = setup(view({ s1: 'running' })).model;
    expect(needsAnimation(running, 10_000)).toBe(true);
  });

  it('holds still at the awaiting level across time', () => {
    const v = view({ s1: 'awaiting_approval' });
    const { model } = setup(v);
    const at = (t: number) => frameAt(model, t).pools.find((p) => p.id === 's1')?.body;
    expect(at(1000)).toEqual(at(4321));
  });
});

describe('settled stream', () => {
  it('necks at the source and flares into a meniscus at contact', () => {
    const base = 8;
    const body = streamHalf(80, 80, base);
    expect(streamHalf(base * 1.8, 100, base)).toBeLessThan(body);
    expect(streamHalf(100, 0, base)).toBeGreaterThan(body * 2);
    expect(streamHalf(0, 100, base)).toBeGreaterThan(streamHalf(base * 1.8, 100, base));
  });

  it('keeps the waist thick enough to survive the goo filter', () => {
    expect(streamHalf(8 * 1.8, 100, 8)).toBeGreaterThanOrEqual(2.6);
  });

  it('crosses the rim on a straight edge instead of stopping at it', () => {
    const v = view({ s1: 'done', s2: 'running' });
    const { model } = setup(v);
    const frame = frameAt(model, BEAD_MS * 4);
    const edge = frame.edges.find((e) => e.id === 's1->s2');
    const target = frame.pools.find((p) => p.id === 's2');
    const source = frame.pools.find((p) => p.id === 's1');
    expect(edge?.stream).toMatch(/Z$/);
    const nums = (edge?.stream.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const reach = (p: { cx: number; cy: number } | undefined) => {
      let min = Infinity;
      for (let i = 0; i < nums.length; i += 2) min = Math.min(min, Math.hypot(nums[i] - (p?.cx ?? 0), nums[i + 1] - (p?.cy ?? 0)));
      return min;
    };
    expect(reach(target)).toBeLessThan(target?.r ?? 0);
    expect(reach(source)).toBeLessThan(source?.r ?? 0);
    // 렌더러가 잘라 내는 곳보다 더 깊이 들어가지는 않는다: 아이콘에 닿지 않는다.
    expect(reach(target)).toBeGreaterThan((target?.r ?? 0) * STREAM_ENTRY - 1.5);
  });

  it('draws no stream on a dry pipe and grows one while it reveals', () => {
    const before = view({});
    const { model } = setup(before);
    expect(frameAt(model, 0).edges.every((e) => e.stream === '')).toBe(true);
    applyView(model, view({ s1: 'running' }), before, 0, true);
    expect(frameAt(model, BEAD_MS * 0.4).edges.find((e) => e.id.endsWith('->s1'))?.stream).toBe('');
    const early = frameAt(model, BEAD_MS * 0.74).edges.find((e) => e.id.endsWith('->s1'))?.stream ?? '';
    const full = frameAt(model, BEAD_MS * 4).edges.find((e) => e.id.endsWith('->s1'))?.stream ?? '';
    expect(full.length).toBeGreaterThan(early.length);
  });
});

describe('stream source', () => {
  const FORK: PlanStep[] = [
    { id: 's1', agent: 'researcher', title: 'a', task: 't', dependsOn: [] },
    { id: 's2', agent: 'researcher', title: 'b', task: 't', dependsOn: [] },
  ];
  const forkView = (statuses: Record<string, StepStatus>): MissionView => ({
    ...view({}),
    plan: { title: 't', route: 'team', steps: FORK },
    stepOrder: ['s1', 's2'],
    steps: { s1: stepView(FORK[0], statuses.s1 ?? 'pending'), s2: stepView(FORK[1], statuses.s2 ?? 'pending') },
  });
  const forkModel = (v: MissionView) => {
    const layout = layoutStage({ steps: FORK, width: 1170, maxHeight: 640 });
    const model = emptyModel();
    syncLayout(model, layout, v, 0, false);
    applyView(model, v, null, 0, false);
    return model;
  };
  const unitY = (pool: { cy: number; r: number } | undefined, y: number) => (y - (pool?.cy ?? 0)) / (pool?.r ?? 1);
  const surfaceOf = (level: number) => POOL_WALL * (1 - 2 * level);

  it('leaves both forks from below the source surface, including the upper one', () => {
    const frame = frameAt(forkModel(forkView({ s1: 'running', s2: 'running' })), BEAD_MS * 4);
    const hub = frame.pools.find((p) => p.id === CONDUCTOR_NODE);
    const forks = frame.edges.filter((e) => e.id.startsWith(CONDUCTOR_NODE));
    expect(forks).toHaveLength(2);
    for (const edge of forks) {
      const [, y] = (edge.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(unitY(hub, y), edge.id).toBeGreaterThan(surfaceOf(hub?.level ?? 0));
    }
  });

  it('adds no blob or hook inside the sending sphere', () => {
    const frame = frameAt(forkModel(forkView({ s1: 'running', s2: 'running' })), BEAD_MS * 4);
    expect(frame.pools.find((p) => p.id === CONDUCTOR_NODE)?.rivulets).toHaveLength(0);
  });

  it('pours from where the stream crosses the wall, not from where the thin line ends inside', () => {
    const frame = frameAt(forkModel(forkView({ s1: 'running' })), BEAD_MS * 4);
    const edge = frame.edges.find((e) => e.id === `${CONDUCTOR_NODE}->s1`);
    const target = frame.pools.find((p) => p.id === 's1');
    if (!edge || !target?.rivulets.length) throw new Error('the stream has not reached the sphere');
    const [x0, y0, x1, y1, x2, y2, x3, y3] = (edge.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    let crossing = 0;
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      if (Math.hypot(x - target.cx, y - target.cy) >= target.r) crossing = Math.atan2(y - target.cy, x - target.cx);
    }
    const [sx, sy] = (target.rivulets[0].d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const apart = Math.abs(Math.atan2(Math.sin(crossing - Math.atan2(sy, sx)), Math.cos(crossing - Math.atan2(sy, sx))));
    expect(apart).toBeLessThan(0.03);
  });

  it('comes out in the source colour and fades to the stream colour', () => {
    const frame = frameAt(forkModel(forkView({ s1: 'running' })), BEAD_MS * 4);
    const edge = frame.edges.find((e) => e.id === `${CONDUCTOR_NODE}->s1`);
    expect(edge?.sourceColor).toBe('var(--agent-conductor)');
    expect(edge?.color).toBe('var(--agent-researcher)');
    const [x1, y1, x2, y2] = edge?.fade ?? [0, 0, 0, 0];
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(20);
  });

  it('launches split beads from below the surface too, with no hook', () => {
    const before = forkView({});
    const model = forkModel(before);
    applyView(model, forkView({ s1: 'running', s2: 'running' }), before, 0, true);
    const frame = frameAt(model, BEAD_MS * 0.12);
    const hub = frame.pools.find((p) => p.id === CONDUCTOR_NODE);
    expect(hub?.rivulets).toHaveLength(0);
    const heads = frame.blobs.filter((b) => b.r > 3);
    expect(heads.length).toBeGreaterThan(0);
    for (const blob of heads) expect(unitY(hub, blob.y)).toBeGreaterThan(surfaceOf(hub?.level ?? 0));
  });

  it('flares where wet and comes to a point where dry, never a blunt end', () => {
    const base = 8;
    expect(streamHalf(0, 100, base, true)).toBeGreaterThan(streamHalf(base * 2.6, 100, base, true) * 2);
    expect(streamHalf(0, 100, base, false)).toBeLessThan(0.1);
  });
});

describe('poolShape', () => {
  const wallDistance = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

  it('draws nothing for an empty sphere', () => {
    const shape = poolShape(0);
    expect(shape.body).toBe('');
    expect(shape.contacts).toBeNull();
  });

  it('meets the glass wall exactly at every level and tilt, with no gap', () => {
    for (const level of [0.03, 0.08, 0.14, 0.44, 0.68, 0.84]) {
      for (const tilt of [-0.25, 0, 0.25]) {
        const { contacts } = poolShape(level, tilt);
        expect(contacts).not.toBeNull();
        for (const contact of contacts ?? []) expect(wallDistance(contact)).toBeCloseTo(POOL_WALL, 6);
      }
    }
  });

  it('rises with the level', () => {
    const y = (level: number) => poolShape(level).contacts?.[0].y ?? 0;
    expect(y(0.8)).toBeLessThan(y(0.5));
    expect(y(0.5)).toBeLessThan(y(0.1));
  });

  it('reports the waterline so the icon can change colour at the surface', () => {
    expect(poolShape(0).waterline).toEqual([100, 100]);
    // 수면 원반 위에 놓인 부분까지 액체 쪽으로 친다: 원반 가운데 선(50%)보다 조금 위에서 바뀐다.
    const half = poolShape(0.5).waterline;
    expect(half[0]).toBeLessThan(50);
    expect(half[0]).toBeGreaterThan(35);
    expect(half[1]).toBe(half[0]);
    const [left, right] = poolShape(0.5, 0.2).waterline;
    expect(right).toBeGreaterThan(left);
  });

  it('is deterministic and uses no sampled polygon edge', () => {
    expect(poolShape(0.4, 0.1, 0.02)).toMatchObject({ body: poolShape(0.4, 0.1, 0.02).body });
    // 수면은 곡선 하나다. 표본을 이어 만든 다각형이면 계단이 다시 생긴다.
    expect(poolShape(0.4).front.match(/C/g)).toHaveLength(1);
  });
});

describe('rivuletPath', () => {
  it('runs down the wall from a port above the surface to the point where the surface meets it', () => {
    const shape = poolShape(0.3);
    const d = rivuletPath(shape, 0, 0.08);
    expect(d).toContain('A');
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const endX = nums[nums.length - 2];
    const endY = nums[nums.length - 1];
    expect(Math.hypot(endX, endY)).toBeCloseTo(POOL_WALL - 0.04, 2);
    expect(endX).toBeGreaterThan(0);
    expect(endY).toBeGreaterThan(0);
  });

  it('adds nothing when the port is already under the surface', () => {
    expect(rivuletPath(poolShape(0.7), 0, 0.08)).toBe('');
  });

  it('runs to the bottom of an empty sphere', () => {
    const nums = (rivuletPath(poolShape(0), Math.PI, 0.08).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    expect(nums[nums.length - 2]).toBeCloseTo(0, 5);
    expect(nums[nums.length - 1]).toBeGreaterThan(0.8);
  });
});

describe('syncTeam', () => {
  const placements: TeamPlacement[] = [
    { id: 'conductor', x: 100, y: 100, size: 60, color: 'var(--a)' },
    { id: 'researcher', x: 100, y: 30, size: 50, color: 'var(--b)' },
    { id: 'writer', x: 160, y: 130, size: 50, color: 'var(--c)' },
  ];

  it('rests dry and perfectly still with no mission', () => {
    const model = emptyModel();
    syncTeam(model, placements, new Map(), 0, 200);
    const frame = frameAt(model, 5000);
    expect(frame.edges).toHaveLength(0);
    expect(frame.blobs).toHaveLength(0);
    expect(frame.pools.every((p) => p.body === '')).toBe(true);
    expect(needsAnimation(model, 5000)).toBe(false);
    expect(frameAt(model, 9000)).toEqual(frame);
  });

  it('gives liquid and a pipe only to the agent actually working', () => {
    const model = emptyModel();
    syncTeam(model, placements, new Map([['researcher', 'running']]), 0, 200);
    const frame = frameAt(model, 5000);
    expect(frame.edges.map((e) => e.id)).toEqual(['researcher']);
    expect(frame.pools.find((p) => p.id === 'researcher')?.body).not.toBe('');
    expect(frame.pools.find((p) => p.id === 'writer')?.body).toBe('');
    expect(frame.pools.find((p) => p.id === 'conductor')?.body).not.toBe('');
    expect(needsAnimation(model, 5000)).toBe(true);
  });

  it('starts a pipe that must leave above the surface as a clean point, with no hook inside the hub', () => {
    const model = emptyModel();
    syncTeam(model, placements, new Map([['researcher', 'running']]), 0, 200);
    const frame = frameAt(model, 8000);
    expect(frame.pools.find((p) => p.id === 'conductor')?.rivulets).toHaveLength(0);
    expect(frame.edges[0].stream).toMatch(/Z$/);
    expect(frame.edges[0].sourceColor).toBe('var(--a)');
  });

  it('holds a waiting agent still behind a paused pipe', () => {
    const model = emptyModel();
    syncTeam(model, placements, new Map([['writer', 'awaiting_approval']]), 0, 200);
    const frame = frameAt(model, 5000);
    expect(frame.edges[0].state).toBe('paused');
    expect(frame.edges[0].width).toBe(0);
    expect(frameAt(model, 7000).pools.find((p) => p.id === 'writer')?.body).toBe(frame.pools.find((p) => p.id === 'writer')?.body);
  });

  it('drains and removes the pipe when the work stops', () => {
    const model = emptyModel();
    syncTeam(model, placements, new Map([['researcher', 'running']]), 0, 200);
    syncTeam(model, placements, new Map(), 1000, 200);
    const frame = frameAt(model, 6000);
    expect(frame.edges).toHaveLength(0);
    expect(frame.pools.every((p) => p.body === '')).toBe(true);
  });
});
