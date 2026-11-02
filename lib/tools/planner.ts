import type { CalendarEvent, Task, TaskPriority } from '@/lib/contracts';
import { addEvent, listEvents, removeEvent } from '@/lib/store/events';
import { addTask, listTasks, patchTask, removeTask } from '@/lib/store/tasks';
import { register } from './registry';

const AGENTS = ['planner'] as const;

function describeTask(t: Task): string {
  const due = t.due ? `, 기한 ${t.due}` : '';
  return `[${t.id}] ${t.done ? '완료' : '미완료'} (${t.priority}${due}) ${t.text}`;
}

function describeEvent(e: CalendarEvent): string {
  const duration = e.durationMin ? `, ${e.durationMin}분` : '';
  return `[${e.id}] ${e.date} ${e.time ?? '종일'} (${e.kind}${duration}) ${e.title}`;
}

const ID_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1, maxLength: 80 } },
  required: ['id'],
  additionalProperties: false,
};

// ─── 할 일 ─────────────────────────────────────────────────
register<{ status?: 'open' | 'done' | 'all' }>({
  name: 'list_tasks',
  description: '할 일 목록을 조회합니다. 기본은 미완료 항목입니다.',
  risk: 'safe',
  group: 'planner',
  agents: [...AGENTS],
  // 할 일과 일정은 이전 미션이 외부 내용을 읽고 쓴 것일 수 있다. 오염을 다음 미션으로 세탁하지 않는다.
  readsUntrusted: true,
  schema: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['open', 'done', 'all'] } },
    additionalProperties: false,
  },
  summarize: () => '할 일 조회',
  async run({ status = 'open' }) {
    const tasks = (await listTasks()).filter((t) =>
      status === 'all' ? true : status === 'done' ? t.done : !t.done
    );
    return tasks.length ? tasks.map(describeTask).join('\n') : '해당하는 할 일이 없습니다';
  },
});

register<{ text: string; priority?: TaskPriority; due?: string }>({
  name: 'add_task',
  description: '할 일을 추가합니다.',
  risk: 'safe',
  group: 'planner',
  agents: [...AGENTS],
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 500 },
      priority: { type: 'string', enum: ['high', 'normal', 'low'] },
      due: { type: 'string', description: 'YYYY-MM-DD' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  summarize: ({ text }) => `할 일 추가: ${text}`,
  async run(input, ctx) {
    const task = await addTask({ ...input, missionId: ctx.missionId });
    ctx.emitArtifact?.({ kind: 'task', id: task.id, title: task.text, ref: task.id });
    return `추가했습니다: ${describeTask(task)}`;
  },
});

register<{ id: string }>({
  name: 'complete_task',
  description: '할 일을 완료로 표시합니다.',
  risk: 'safe',
  group: 'planner',
  agents: [...AGENTS],
  sideEffect: true,
  schema: ID_SCHEMA,
  summarize: ({ id }) => `할 일 완료: ${id}`,
  async run({ id }) {
    return `완료했습니다: ${describeTask(await patchTask(id, { done: true }))}`;
  },
});

register<{ id: string }>({
  name: 'remove_task',
  description: '할 일을 삭제합니다.',
  risk: 'confirm',
  group: 'planner',
  agents: [...AGENTS],
  sideEffect: true,
  schema: ID_SCHEMA,
  summarize: ({ id }) => `할 일 삭제: ${id}`,
  async run({ id }) {
    await removeTask(id);
    return `삭제했습니다: ${id}`;
  },
});

// ─── 일정 ─────────────────────────────────────────────────
register<{ from?: string; to?: string }>({
  name: 'list_events',
  description: '일정을 조회합니다. 날짜 범위를 주면 그 범위만 돌려줍니다.',
  risk: 'safe',
  group: 'planner',
  agents: [...AGENTS],
  readsUntrusted: true,
  schema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
    },
    additionalProperties: false,
  },
  summarize: ({ from, to }) => `일정 조회${from || to ? ` (${from ?? ''}~${to ?? ''})` : ''}`,
  async run(range) {
    const events = await listEvents(range);
    return events.length ? events.map(describeEvent).join('\n') : '해당하는 일정이 없습니다';
  },
});

register<{ title: string; date: string; time?: string; durationMin?: number; kind?: CalendarEvent['kind'] }>({
  name: 'add_event',
  description: '일정을 추가합니다. 날짜를 모르면 먼저 get_current_time으로 오늘 날짜를 확인하세요.',
  risk: 'safe',
  group: 'planner',
  agents: [...AGENTS],
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      time: { type: 'string', description: 'HH:mm (24시간). 생략하면 종일 일정' },
      durationMin: { type: 'integer', minimum: 1, maximum: 1440 },
      kind: { type: 'string', enum: ['work', 'meeting', 'personal'] },
    },
    required: ['title', 'date'],
    additionalProperties: false,
  },
  summarize: ({ title, date, time }) => `일정 추가: ${date} ${time ?? '종일'} ${title}`,
  async run(input, ctx) {
    const event = await addEvent({ ...input, missionId: ctx.missionId });
    ctx.emitArtifact?.({ kind: 'event', id: event.id, title: event.title, ref: event.id });
    return `추가했습니다: ${describeEvent(event)}`;
  },
});

register<{ id: string }>({
  name: 'remove_event',
  description: '일정을 삭제합니다.',
  risk: 'confirm',
  group: 'planner',
  agents: [...AGENTS],
  sideEffect: true,
  schema: ID_SCHEMA,
  summarize: ({ id }) => `일정 삭제: ${id}`,
  async run({ id }) {
    await removeEvent(id);
    return `삭제했습니다: ${id}`;
  },
});
