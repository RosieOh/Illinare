import type { Task, TaskPriority } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, newId, readJson, updateJson } from './json';

const file = () => dataPath('tasks.json');
const PRIORITIES: TaskPriority[] = ['high', 'normal', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 달력에 실제로 있는 날짜인가. 2026-02-31 같은 값은 되돌렸을 때 값이 달라진다. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertText(text: unknown): string {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > 500) {
    throw new ApiError(400, 'invalid_task', '할 일 내용은 1~500자여야 해요.');
  }
  return trimmed;
}

export async function listTasks(): Promise<Task[]> {
  return readJson<Task[]>(file(), []);
}

export async function addTask(input: {
  text: unknown;
  priority?: unknown;
  due?: unknown;
  missionId?: string;
}): Promise<Task> {
  const task: Task = {
    id: newId('task'),
    text: assertText(input.text),
    done: false,
    priority: PRIORITIES.includes(input.priority as TaskPriority) ? (input.priority as TaskPriority) : 'normal',
    createdAt: Date.now(),
  };
  if (input.due !== undefined && input.due !== null && input.due !== '') {
    if (!isIsoDate(input.due)) throw new ApiError(400, 'invalid_task', '기한은 YYYY-MM-DD 형식이어야 해요.');
    task.due = input.due;
  }
  if (input.missionId) task.missionId = input.missionId;
  await updateJson<Task[]>(file(), [], (tasks) => [...tasks, task]);
  return task;
}

export async function patchTask(id: string, patch: Record<string, unknown>): Promise<Task> {
  let updated: Task | undefined;
  await updateJson<Task[]>(file(), [], (tasks) =>
    tasks.map((t) => {
      if (t.id !== id) return t;
      const next: Task = { ...t };
      if ('text' in patch) next.text = assertText(patch.text);
      if ('priority' in patch) {
        if (!PRIORITIES.includes(patch.priority as TaskPriority)) {
          throw new ApiError(400, 'invalid_task', '우선순위 값이 올바르지 않아요.');
        }
        next.priority = patch.priority as TaskPriority;
      }
      if ('due' in patch) {
        if (patch.due === null || patch.due === '') delete next.due;
        else if (isIsoDate(patch.due)) next.due = patch.due;
        else throw new ApiError(400, 'invalid_task', '기한은 YYYY-MM-DD 형식이어야 해요.');
      }
      if ('done' in patch) {
        next.done = Boolean(patch.done);
        if (next.done) next.completedAt = Date.now();
        else delete next.completedAt;
      }
      updated = next;
      return next;
    })
  );
  if (!updated) throw new ApiError(404, 'not_found', '할 일을 찾을 수 없어요.');
  return updated;
}

export async function removeTask(id: string): Promise<void> {
  let found = false;
  await updateJson<Task[]>(file(), [], (tasks) => {
    found = tasks.some((t) => t.id === id);
    return tasks.filter((t) => t.id !== id);
  });
  if (!found) throw new ApiError(404, 'not_found', '할 일을 찾을 수 없어요.');
}

/** 구버전 데이터 이전 전용. 같은 id가 이미 있으면 건너뛰어 여러 번 불러도 한 번만 들어간다. */
export async function importTasks(tasks: Task[]): Promise<void> {
  await updateJson<Task[]>(file(), [], (current) => {
    const known = new Set(current.map((t) => t.id));
    return [...current, ...tasks.filter((t) => !known.has(t.id))];
  });
}
