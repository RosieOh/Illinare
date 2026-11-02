import { describe, expect, it } from 'vitest';
import { capRows, collapseUnchanged, lineDiff } from '@/components/mission/diff';
import { ANSWER_NODE, CONDUCTOR_NODE } from '@/components/mission/layout';
import { answerStatus, conductorStatus, edgeState, effectiveMissionStatus, stepCaption, visibleReason } from '@/components/mission/status';
import type { MissionView, StepStatus, StepView } from '@/lib/contracts';
import { emptyUsage } from '@/lib/missions/reducer';

function step(id: string, status: StepStatus, activity = ''): StepView {
  return {
    step: { id, agent: 'researcher', title: id, task: id, dependsOn: [] },
    status,
    thinking: '',
    text: '',
    activity,
    toolCalls: [],
    usage: emptyUsage(),
    tainted: false,
  };
}

function view(patch: Partial<MissionView>): MissionView {
  return {
    id: 'm',
    goal: 'g',
    title: 't',
    status: 'running',
    mode: 'demo',
    plan: { title: 't', route: 'team', steps: [] },
    steps: {},
    stepOrder: [],
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

describe('edgeState', () => {
  const into = { from: CONDUCTOR_NODE, to: 's1', kind: 'dispatch' as const };
  const out = { from: 's1', to: ANSWER_NODE, kind: 'merge' as const };

  it('maps each downstream step status one to one', () => {
    const cases: Array<[StepStatus, string]> = [
      ['pending', 'idle'],
      ['running', 'flow'],
      ['awaiting_approval', 'paused'],
      ['done', 'done'],
      ['failed', 'failed'],
      ['skipped', 'skipped'],
      ['cancelled', 'cancelled'],
    ];
    for (const [status, expected] of cases) {
      expect(edgeState(into, view({ steps: { s1: step('s1', status) } }))).toBe(expected);
    }
  });

  it('keeps a merge edge idle until its source finishes, then flows while synthesizing', () => {
    expect(edgeState(out, view({ steps: { s1: step('s1', 'running') } }))).toBe('idle');
    expect(edgeState(out, view({ status: 'synthesizing', steps: { s1: step('s1', 'done') } }))).toBe('flow');
    expect(edgeState(out, view({ status: 'done', steps: { s1: step('s1', 'done') } }))).toBe('done');
  });

  it('shows a failed source as failed on the way to the answer', () => {
    expect(edgeState(out, view({ steps: { s1: step('s1', 'failed') } }))).toBe('failed');
  });

  it('flows the direct conductor to answer edge on the answer route', () => {
    const edge = { from: CONDUCTOR_NODE, to: ANSWER_NODE, kind: 'merge' as const };
    expect(edgeState(edge, view({ status: 'synthesizing' }))).toBe('flow');
    expect(edgeState(edge, view({ status: 'done' }))).toBe('done');
  });
});

describe('hub status', () => {
  it('follows the mission state', () => {
    expect(conductorStatus(view({ status: 'planning', plan: null }))).toBe('running');
    expect(conductorStatus(view({ status: 'awaiting_plan' }))).toBe('awaiting_approval');
    expect(conductorStatus(view({ status: 'failed', plan: null }))).toBe('failed');
    expect(conductorStatus(view({ status: 'running' }))).toBe('done');
    expect(answerStatus(view({ status: 'running' }))).toBe('pending');
    expect(answerStatus(view({ status: 'synthesizing' }))).toBe('running');
    expect(answerStatus(view({ status: 'done' }))).toBe('done');
  });

  it('reports approval waiting even while the mission is running', () => {
    const approval = { id: 'a', kind: 'tool' as const, agent: 'writer' as const, summary: 's', risk: 'confirm' as const, reason: 'r', requestedAt: 0 };
    expect(effectiveMissionStatus(view({ status: 'running', approvals: [approval] }))).toBe('awaiting_approval');
    expect(effectiveMissionStatus(view({ status: 'running' }))).toBe('running');
  });
});

describe('stepCaption', () => {
  it('prefers the live activity while running and falls back to the agent name', () => {
    const v = view({ steps: { a: step('a', 'running', '웹 검색 중'), b: step('b', 'running'), c: step('c', 'done') } });
    expect(stepCaption(v, 'a')).toBe('웹 검색 중');
    expect(stepCaption(v, 'b')).toContain('리서처');
    expect(stepCaption(v, 'c')).toBe('리서처');
  });
});

describe('visibleReason', () => {
  it('hides a server reason that repeats the taint warning', () => {
    expect(visibleReason({ tainted: true, reason: '외부 데이터를 읽은 뒤의 요청입니다.' })).toBeNull();
  });
  it('keeps unrelated reasons', () => {
    expect(visibleReason({ tainted: true, reason: '새 파일을 만들어요.' })).toBe('새 파일을 만들어요.');
    expect(visibleReason({ reason: '외부 데이터를 읽어요.' })).toBe('외부 데이터를 읽어요.');
  });
});

describe('capRows', () => {
  it('leaves ordinary diffs alone', () => {
    expect(capRows([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('keeps the head and the tail of a huge diff and says how much it hid', () => {
    const rows = Array.from({ length: 100 }, (_, i) => i);
    const capped = capRows(rows, 20);
    expect(capped).toHaveLength(21);
    expect(capped[0]).toBe(0);
    expect(capped[capped.length - 1]).toBe(99);
    expect(capped).toContainEqual({ hidden: 80 });
  });
});

describe('lineDiff', () => {
  it('marks replaced lines on the same row', () => {
    const rows = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(rows).toHaveLength(3);
    expect(rows[1].left).toMatchObject({ text: 'b', changed: true, line: 2 });
    expect(rows[1].right).toMatchObject({ text: 'B', changed: true, line: 2 });
    expect(rows[0].left?.changed).toBe(false);
    expect(rows[2].right?.changed).toBe(false);
  });

  it('handles pure insertions and deletions', () => {
    const inserted = lineDiff('a\nc', 'a\nb\nc');
    expect(inserted[1].left).toBeNull();
    expect(inserted[1].right).toMatchObject({ text: 'b', changed: true });
    const removed = lineDiff('a\nb\nc', 'a\nc');
    expect(removed[1].right).toBeNull();
    expect(removed[1].left).toMatchObject({ text: 'b', changed: true });
  });

  it('treats an empty before as a brand new file', () => {
    const rows = lineDiff('', 'x\ny');
    expect(rows.every((r) => r.left === null && r.right?.changed)).toBe(true);
  });

  it('survives very large inputs without building an LCS table', () => {
    const before = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 4000 }, (_, i) => `b${i}`).join('\n');
    expect(lineDiff(before, after)).toHaveLength(4000);
  });

  it('normalizes CRLF so line endings alone do not count as changes', () => {
    expect(lineDiff('a\r\nb', 'a\nb').every((r) => !r.left?.changed && !r.right?.changed)).toBe(true);
  });
});

describe('collapseUnchanged', () => {
  it('folds long unchanged runs and keeps context around changes', () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l20', 'CHANGED');
    const out = collapseUnchanged(lineDiff(before, after), 2);
    expect(out.filter((r) => r === null)).toHaveLength(2);
    expect(out.filter(Boolean)).toHaveLength(5);
  });
});
