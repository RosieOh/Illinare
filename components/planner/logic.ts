import type { CalendarEvent, Task, TaskPriority } from '@/lib/contracts';

/** 할 일과 일정의 필터, 정렬, 겹침 계산. 전부 순수 함수. */

export type TaskFilter = 'today' | 'upcoming' | 'all' | 'done';
export type TaskSort = 'smart' | 'due' | 'priority' | 'recent';

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export function filterTasks(tasks: Task[], filter: TaskFilter, today: string): Task[] {
  switch (filter) {
    case 'today':
      return tasks.filter((t) => !t.done && t.due !== undefined && t.due <= today);
    case 'upcoming':
      return tasks.filter((t) => !t.done && t.due !== undefined && t.due > today);
    case 'done':
      return tasks.filter((t) => t.done);
    case 'all':
      return tasks;
  }
}

/** 기한이 없는 항목은 항상 뒤로 보낸다. */
function compareDue(a: Task, b: Task): number {
  if (a.due && b.due) return a.due.localeCompare(b.due);
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
}

function comparePriority(a: Task, b: Task): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function compareRecent(a: Task, b: Task): number {
  return b.createdAt - a.createdAt;
}

/** 지금 무엇을 먼저 봐야 하는가: 지난 것 → 오늘 → 높은 우선순위 → 가까운 기한 → 나머지 */
function smartBucket(t: Task, today: string): number {
  if (t.due && t.due < today) return 0;
  if (t.due === today) return 1;
  if (t.priority === 'high') return 2;
  if (t.due) return 3;
  return 4;
}

export function sortTasks(tasks: Task[], sort: TaskSort, today: string): Task[] {
  const compare = (a: Task, b: Task): number => {
    // 끝낸 항목은 어떤 정렬에서도 맨 아래로 내린다.
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    switch (sort) {
      case 'smart':
        return (
          smartBucket(a, today) - smartBucket(b, today) ||
          compareDue(a, b) ||
          comparePriority(a, b) ||
          compareRecent(a, b)
        );
      case 'due':
        return compareDue(a, b) || comparePriority(a, b) || compareRecent(a, b);
      case 'priority':
        return comparePriority(a, b) || compareDue(a, b) || compareRecent(a, b);
      case 'recent':
        return compareRecent(a, b);
    }
  };
  return [...tasks].sort(compare);
}

export function taskCounts(tasks: Task[], today: string): Record<TaskFilter, number> {
  return {
    today: filterTasks(tasks, 'today', today).length,
    upcoming: filterTasks(tasks, 'upcoming', today).length,
    all: tasks.length,
    done: filterTasks(tasks, 'done', today).length,
  };
}

// ─── 일정 ────────────────────────────────────────────────────
const DEFAULT_DURATION = 60;

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function eventRange(e: CalendarEvent): { start: number; end: number } | null {
  if (!e.time) return null;
  const start = minutesOf(e.time);
  return { start, end: start + (e.durationMin ?? DEFAULT_DURATION) };
}

/** 종일 일정을 먼저, 그다음 시작 시간순 */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (!a.time !== !b.time) return a.time ? 1 : -1;
    return (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt - b.createdAt;
  });
}

/** 같은 날 시간이 겹치는 일정의 id */
export function findOverlaps(events: CalendarEvent[]): Set<string> {
  const overlapping = new Set<string>();
  const byDate = new Map<string, Array<{ id: string; start: number; end: number }>>();
  for (const e of events) {
    const range = eventRange(e);
    if (!range) continue;
    const list = byDate.get(e.date) ?? [];
    list.push({ id: e.id, ...range });
    byDate.set(e.date, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    let reachId: string | null = null;
    for (const item of list) {
      if (item.start < reach && reachId) {
        overlapping.add(item.id);
        overlapping.add(reachId);
      }
      if (item.end > reach) {
        reach = item.end;
        reachId = item.id;
      }
    }
  }
  return overlapping;
}

export type AgendaPhase = 'past' | 'now' | 'next' | 'later' | 'allDay';

export interface AgendaItem {
  event: CalendarEvent;
  phase: AgendaPhase;
}

/** 오늘 일정에 지금 시각 기준의 단계를 붙인다. 다음 일정은 하나만 'next'가 된다. */
export function buildAgenda(events: CalendarEvent[], nowMinutes: number): AgendaItem[] {
  let nextAssigned = false;
  return sortEvents(events).map((event) => {
    const range = eventRange(event);
    if (!range) return { event, phase: 'allDay' as const };
    if (event.done || range.end <= nowMinutes) return { event, phase: 'past' as const };
    if (range.start <= nowMinutes) return { event, phase: 'now' as const };
    if (!nextAssigned) {
      nextAssigned = true;
      return { event, phase: 'next' as const };
    }
    return { event, phase: 'later' as const };
  });
}

/** 지금 표시선이 들어갈 자리 (이 인덱스 앞에 놓는다). 아무것도 안 지났으면 시간 있는 첫 일정 앞. */
export function nowMarkerIndex(items: AgendaItem[], nowMinutes: number): number {
  let index = 0;
  items.forEach((item, i) => {
    if (item.phase === 'allDay') {
      index = i + 1;
      return;
    }
    const range = eventRange(item.event);
    if (range && range.start <= nowMinutes) index = i + 1;
  });
  return index;
}

/** 분을 말로: 45분 뒤, 1시간 뒤, 1시간 30분 뒤 */
export function untilLabel(minutes: number): string {
  if (minutes <= 0) return '곧';
  if (minutes < 60) return `${minutes}분 뒤`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간 뒤` : `${h}시간 ${m}분 뒤`;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
