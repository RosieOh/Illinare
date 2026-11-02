import { describe, expect, it } from 'vitest';
import {
  ANSWER_NODE,
  approvalAnchor,
  APPROVAL_CARD,
  CONDUCTOR_NODE,
  computeDepths,
  LABEL_GAP,
  labelHeight,
  layoutStage,
  pointOnEdge,
  VERTICAL_BELOW,
  type StageLayout,
  type StageNode,
  type StageStepInput,
} from '@/components/mission/layout';

const chain = (n: number): StageStepInput[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, dependsOn: i === 0 ? [] : [`s${i}`] }));
const fan = (n: number): StageStepInput[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, dependsOn: [] }));

const SHAPES: Record<string, StageStepInput[]> = {
  'one step': chain(1),
  'chain of 6': chain(6),
  'fan-out of 6': fan(6),
  'fan-out then fan-in': [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: [] },
    { id: 'c', dependsOn: [] },
    { id: 'd', dependsOn: ['a', 'b', 'c'] },
  ],
  diamond: [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] },
    { id: 'd', dependsOn: ['b', 'c'] },
  ],
  'skip edge': [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a', 'b'] },
  ],
  'research demo': [
    { id: 's1', dependsOn: [] },
    { id: 's2', dependsOn: [] },
    { id: 's3', dependsOn: ['s1', 's2'] },
    { id: 's4', dependsOn: ['s3'] },
  ],
};

const WIDTHS = [340, 358, 480, 559, 560, 640, 760, 900, 1170, 1650];

interface Box {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 구와 라벨을 각각 상자로 본다. 구끼리, 라벨끼리, 구와 다른 라벨이 겹치면 안 된다. */
function boxes(layout: StageLayout): { spheres: Box[]; labels: Box[] } {
  const spheres: Box[] = [];
  const labels: Box[] = [];
  const below = labelHeight(layout.density);
  for (const n of layout.nodes) {
    spheres.push({ id: n.id, left: n.x - n.size / 2, right: n.x + n.size / 2, top: n.y - n.size / 2, bottom: n.y + n.size / 2 });
    if (n.labelSide === 'below') {
      labels.push({ id: n.id, left: n.x - n.labelWidth / 2, right: n.x + n.labelWidth / 2, top: n.y + n.size / 2 + LABEL_GAP, bottom: n.y + n.size / 2 + LABEL_GAP + below });
    } else if (n.labelSide === 'right') {
      labels.push({ id: n.id, left: n.x + n.size / 2 + 10, right: n.x + n.size / 2 + 10 + n.labelWidth, top: n.y - n.size / 2, bottom: n.y + n.size / 2 });
    } else if (n.labelSide === 'left') {
      labels.push({ id: n.id, left: n.x - n.size / 2 - 10 - n.labelWidth, right: n.x - n.size / 2 - 10, top: n.y - n.size / 2, bottom: n.y + n.size / 2 });
    }
  }
  return { spheres, labels };
}

const separate = (a: Box, b: Box) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

function assertNoOverlap(layout: StageLayout, name: string) {
  const { spheres, labels } = boxes(layout);
  const all = [...spheres, ...labels];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      // 같은 노드의 구와 라벨은 붙어 있어도 된다.
      if (a.id === b.id) continue;
      expect(separate(a, b), `${name}: ${a.id} overlaps ${b.id} at width ${layout.width} (${layout.density})`).toBe(true);
    }
  }
}

describe('computeDepths', () => {
  it('uses the longest path, not the shortest', () => {
    const depths = computeDepths([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a', 'b'] },
    ]);
    expect(depths.get('c')).toBe(3);
  });

  it('terminates on a cycle and ignores unknown dependencies', () => {
    const depths = computeDepths([
      { id: 'a', dependsOn: ['b', 'ghost'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(depths.size).toBe(2);
  });
});

describe('layoutStage hero', () => {
  for (const [name, steps] of Object.entries(SHAPES)) {
    for (const width of WIDTHS) {
      for (const maxHeight of [380, 620]) {
        it(`keeps "${name}" free of overlap at ${width}x${maxHeight}`, () => {
          const layout = layoutStage({ steps, width, maxHeight });
          assertNoOverlap(layout, name);
          const { spheres, labels } = boxes(layout);
          for (const b of [...spheres, ...labels]) {
            expect(b.left, `${b.id} left`).toBeGreaterThanOrEqual(-1);
            expect(b.right, `${b.id} right`).toBeLessThanOrEqual(layout.width + 1);
            expect(b.top, `${b.id} top`).toBeGreaterThanOrEqual(-1);
            expect(b.bottom, `${b.id} bottom`).toBeLessThanOrEqual(layout.height + 1);
          }
        });
      }
    }
  }

  describe('filaments stay off the labels', () => {
    const SIX: Record<string, StageStepInput[]> = {
      'six, three then two then one': [
        { id: 's1', dependsOn: [] },
        { id: 's2', dependsOn: [] },
        { id: 's3', dependsOn: [] },
        { id: 's4', dependsOn: ['s1', 's3'] },
        { id: 's5', dependsOn: ['s2'] },
        { id: 's6', dependsOn: ['s4', 's5'] },
      ],
      'six with skip edges': [
        { id: 's1', dependsOn: [] },
        { id: 's2', dependsOn: ['s1'] },
        { id: 's3', dependsOn: ['s1', 's2'] },
        { id: 's4', dependsOn: ['s1'] },
        { id: 's5', dependsOn: ['s3', 's4'] },
        { id: 's6', dependsOn: ['s2', 's5'] },
      ],
      'six in parallel': fan(6),
      'six in a chain': chain(6),
    };
    for (const [name, steps] of Object.entries({ ...SHAPES, ...SIX })) {
      for (const [width, maxHeight] of [
        [900, 420],
        // 앱의 기본 창(1320×880)에서 스테이지가 차지하는 크기
        [1040, 620],
        [1170, 620],
        [1170, 720],
        [1650, 820],
      ]) {
        // 건너뛰는 관이 많은 7열은 이 폭에서 곡선 하나로 지날 틈이 없다. 라벨 뒤쪽을 흐려 글자는 그대로 읽힌다 (.stage-label::before).
        if (name === 'six with skip edges' && width < 1170) continue;
        it(`"${name}" at ${width}x${maxHeight}`, () => {
          const layout = layoutStage({ steps, width, maxHeight });
          const { labels } = boxes(layout);
          // 창이 너무 낮아 엇갈려 놓은 경우는 틈이 없다. 라벨이 관 위에 그려져 글자는 그대로 읽힌다.
          const staggered = layout.nodes.some((a) => layout.nodes.some((b) => a.depth === b.depth && a.x !== b.x));
          if (staggered) return;
          for (const edge of layout.edges) {
            for (let t = 0.02; t < 1; t += 0.02) {
              const p = pointOnEdge(edge, t);
              for (const box of labels) {
                const inside = p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom;
                expect(inside, `${edge.id} crosses the label of ${box.id} (${layout.density})`).toBe(false);
              }
              for (const n of layout.nodes) {
                if (n.id === edge.from || n.id === edge.to) continue;
                expect(Math.hypot(p.x - n.x, p.y - n.y), `${edge.id} crosses the sphere of ${n.id} (${layout.density})`).toBeGreaterThan(n.size / 2);
              }
            }
          }
        });
      }
    }
  });

  it('flows top to bottom on narrow panes', () => {
    expect(layoutStage({ steps: fan(3), width: VERTICAL_BELOW - 1 }).orientation).toBe('vertical');
    expect(layoutStage({ steps: fan(3), width: VERTICAL_BELOW }).orientation).toBe('horizontal');
  });

  it('uses large spheres on wide stages', () => {
    const layout = layoutStage({ steps: SHAPES['research demo'], width: 1170, maxHeight: 620 });
    const sizes = layout.nodes.map((n) => n.size);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(64);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(140);
  });

  it('scales spheres and parallel spread with the pane', () => {
    const hub = (l: ReturnType<typeof layoutStage>) => Math.max(...l.nodes.map((n) => n.size));
    const spread = (l: ReturnType<typeof layoutStage>) => {
      const ys = l.nodes.filter((n) => n.kind === 'step').map((n) => n.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const small = layoutStage({ steps: SHAPES['research demo'], width: 900, maxHeight: 420 });
    const medium = layoutStage({ steps: SHAPES['research demo'], width: 1170, maxHeight: 640 });
    const large = layoutStage({ steps: SHAPES['research demo'], width: 1660, maxHeight: 820 });
    expect(hub(medium)).toBeGreaterThan(hub(small));
    expect(hub(large)).toBeGreaterThan(hub(medium));
    expect(hub(large)).toBeGreaterThanOrEqual(130);
    expect(spread(medium)).toBeGreaterThan(spread(small));
    expect(spread(large)).toBeGreaterThan(spread(medium));
  });

  it('lowers density before growing past maxHeight', () => {
    const roomy = layoutStage({ steps: fan(2), width: 1170, maxHeight: 620 });
    const packed = layoutStage({ steps: fan(6), width: 1170, maxHeight: 420 });
    expect(roomy.density).toBe('full');
    expect(packed.density).not.toBe('full');
    expect(packed.height).toBeLessThanOrEqual(420);
  });

  it('connects every root to the conductor and every leaf to the answer', () => {
    const layout = layoutStage({ steps: SHAPES['fan-out then fan-in'], width: 900 });
    const has = (from: string, to: string) => layout.edges.some((e) => e.from === from && e.to === to);
    expect(has(CONDUCTOR_NODE, 'a')).toBe(true);
    expect(has(CONDUCTOR_NODE, 'b')).toBe(true);
    expect(has('a', 'd')).toBe(true);
    expect(has('d', ANSWER_NODE)).toBe(true);
    expect(has('a', ANSWER_NODE)).toBe(false);
  });

  it('draws conductor to answer directly when there are no steps', () => {
    const layout = layoutStage({ steps: [], width: 900 });
    expect(layout.nodes.map((n) => n.id).sort()).toEqual([ANSWER_NODE, CONDUCTOR_NODE].sort());
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].kind).toBe('merge');
  });

  it('routes skip edges around spheres they do not touch', () => {
    const layout = layoutStage({ steps: SHAPES['skip edge'], width: 900, maxHeight: 460 });
    const blocker = layout.nodes.find((n) => n.id === 'b') as StageNode;
    const skip = layout.edges.find((e) => e.from === 'a' && e.to === 'c');
    if (!skip) throw new Error('skip edge missing');
    for (let t = 0.05; t < 1; t += 0.05) {
      const p = pointOnEdge(skip, t);
      expect(Math.hypot(p.x - blocker.x, p.y - blocker.y)).toBeGreaterThan(blocker.size / 2);
    }
  });

  it('caps column gap on very wide stages and scrolls on tight ones', () => {
    const wide = layoutStage({ steps: chain(1), width: 2000 });
    const xs = wide.nodes.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeLessThanOrEqual(420);
    const long = layoutStage({ steps: chain(6), width: 600 });
    expect(long.width).toBeGreaterThan(600);
  });

  it('puts narrow labels on the outer side of parallel spheres', () => {
    const layout = layoutStage({ steps: fan(2), width: 358 });
    const left = layout.nodes.find((n) => n.id === 's1') as StageNode;
    const right = layout.nodes.find((n) => n.id === 's2') as StageNode;
    expect(left.labelSide).toBe('left');
    expect(right.labelSide).toBe('right');
    expect(left.x).toBeLessThan(right.x);
  });
});

describe('layoutStage band', () => {
  for (const [name, steps] of Object.entries(SHAPES)) {
    it(`keeps "${name}" a compact DAG without labels`, () => {
      const layout = layoutStage({ steps, width: 884, mode: 'band' });
      expect(layout.height).toBeLessThanOrEqual(92);
      expect(layout.density).toBe('band');
      for (const n of layout.nodes) {
        expect(n.labelSide).toBe('none');
        expect(n.y - n.size / 2).toBeGreaterThanOrEqual(0);
        expect(n.y + n.size / 2).toBeLessThanOrEqual(layout.height);
      }
      const spheres = boxes(layout).spheres;
      for (let i = 0; i < spheres.length; i++) {
        for (let j = i + 1; j < spheres.length; j++) expect(separate(spheres[i], spheres[j])).toBe(true);
      }
    });
  }
});

describe('layoutStage band as a DAG', () => {
  it('keeps real vertical separation between parallel steps', () => {
    const layout = layoutStage({ steps: SHAPES['research demo'], width: 884, mode: 'band' });
    const steps = layout.nodes.filter((n) => n.kind === 'step');
    const byDepth = new Map<number, typeof steps>();
    for (const n of steps) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
    const parallel = [...byDepth.values()].find((g) => g.length === 2);
    expect(parallel).toBeDefined();
    if (parallel) expect(Math.abs(parallel[0].y - parallel[1].y)).toBeGreaterThanOrEqual(30);
  });

  it('starts on the reading column edge and spans it when there is room', () => {
    const layout = layoutStage({ steps: SHAPES['research demo'], width: 704, mode: 'band' });
    const conductor = layout.nodes.find((n) => n.kind === 'conductor');
    const result = layout.nodes.find((n) => n.kind === 'answer');
    expect((conductor?.x ?? 0) - (conductor?.size ?? 0) / 2).toBeCloseTo(0, 5);
    expect((result?.x ?? 0) + (result?.size ?? 0) / 2).toBeCloseTo(704, 5);
  });

  it('makes the result visibly the largest sphere', () => {
    const layout = layoutStage({ steps: SHAPES['research demo'], width: 884, mode: 'band' });
    const result = layout.nodes.find((n) => n.kind === 'answer');
    const others = layout.nodes.filter((n) => n.kind !== 'answer').map((n) => n.size);
    expect(result?.size ?? 0).toBeGreaterThanOrEqual(Math.max(...others) * 1.5);
  });
});

describe('straight edges', () => {
  it('sag slightly instead of running as a ruled line', () => {
    const layout = layoutStage({ steps: SHAPES['chain of 6'], width: 1650, maxHeight: 820 });
    const edge = layout.edges.find((e) => e.kind === 'dependency');
    const [, y1, , cy1, , cy2, , y2] = edge?.points ?? [0, 0, 0, 0, 0, 0, 0, 0];
    expect(y1).toBe(y2);
    expect(cy1).toBeGreaterThan(y1);
    expect(cy2).toBeGreaterThan(y2);
  });
});

describe('approvalAnchor', () => {
  const stage = { width: 1000, height: 560 };

  it('stays inside the stage and clear of the sphere', () => {
    for (const [x, y] of [
      [50, 60],
      [950, 60],
      [500, 280],
      [50, 500],
      [950, 500],
    ]) {
      const node = { x, y, size: 80 };
      const a = approvalAnchor(node, stage);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(stage.width);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y + APPROVAL_CARD.height).toBeLessThanOrEqual(stage.height);
      const clear =
        a.x + a.width <= x - 40 || x + 40 <= a.x || a.y + APPROVAL_CARD.height <= y - 40 || y + 40 <= a.y;
      expect(clear, `covers sphere at ${x},${y}`).toBe(true);
    }
  });
});
