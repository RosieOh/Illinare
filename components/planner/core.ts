import type { CalendarEvent, Task, TaskPriority } from '@/lib/contracts';
import { api, ClientApiError } from '@/lib/client/api';

/**
 * 할 일과 일정의 단일 저장소 (React 없는 부분). 오늘 화면과 플래너가 같은 데이터를 본다.
 * 변경은 화면에 먼저 반영하고, 실패하면 그 항목만 되돌린다.
 * 에이전트도 이 데이터를 바꾸므로 서버가 기준이지만, 내 변경이 진행 중일 때 받은 목록은 믿지 않는다.
 */
export interface PlannerState {
  tasks: Task[];
  events: CalendarEvent[];
  status: 'loading' | 'ready' | 'error';
  /** 불러오기가 실패했을 때 보여줄 말 */
  error?: string;
}

export type EventInput = Pick<CalendarEvent, 'title' | 'date' | 'kind'> & { time?: string; durationMin?: number };

export const INITIAL_PLANNER_STATE: PlannerState = { tasks: [], events: [], status: 'loading' };

let state: PlannerState = INITIAL_PLANNER_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<PlannerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribePlanner(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getPlannerState(): PlannerState {
  return state;
}

export function plannerErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ClientApiError ? err.message : fallback;
}

// ─── 동기화 ──────────────────────────────────────────────────
/** 진행 중인 변경 요청 수. 0보다 크면 서버 목록이 곧 낡으므로 화면에 쓰지 않는다. */
let inFlight = 0;
/** 변경이 시작되거나 끝날 때마다 오른다. 읽는 사이 변경이 있었는지 알아내는 데 쓴다. */
let epoch = 0;
let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/** 삭제 대기 중인 id. 되돌리기 시간이 끝나기 전에 받은 목록에서도 숨긴다. */
const pendingDeletes = new Map<string, { kind: 'task' | 'event'; timer: ReturnType<typeof setTimeout> }>();

/** 아직 서버에 저장되지 않은 항목. 삭제와 편집을 잠시 막는다. */
export function isTemp(id: string) {
  return id.startsWith('tmp_');
}

function mergeFetched(tasks: Task[], events: CalendarEvent[]) {
  setState({
    tasks: [...tasks.filter((t) => !pendingDeletes.has(t.id)), ...state.tasks.filter((t) => isTemp(t.id))],
    events: [...events.filter((e) => !pendingDeletes.has(e.id)), ...state.events.filter((e) => isTemp(e.id))],
    status: 'ready',
    error: undefined,
  });
}

/** 서버에서 다시 읽는다. 동시에 여러 번 불러도 한 번만 나가고, 변경이 진행 중이면 끝난 뒤로 미룬다. */
export function refreshPlanner(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  if (inFlight > 0) {
    refreshAgain = true;
    return Promise.resolve();
  }
  const startedAt = epoch;
  refreshing = Promise.all([
    api.get<{ tasks: Task[] }>('/api/tasks'),
    api.get<{ events: CalendarEvent[] }>('/api/events'),
  ])
    .then(([t, e]) => {
      // 읽는 사이 변경이 시작됐거나 끝났다면 이 목록은 낡았다. 버리고 변경이 끝난 뒤 다시 읽는다.
      if (startedAt === epoch && inFlight === 0) mergeFetched(t.tasks, e.events);
      else refreshAgain = true;
    })
    .catch((err) => {
      // 이미 보여주던 목록이 있으면 지우지 않는다. 다음 동기화에서 회복된다.
      if (state.status !== 'ready') {
        setState({ status: 'error', error: plannerErrorMessage(err, '할 일과 일정을 불러오지 못했어요.') });
      }
    })
    .finally(() => {
      refreshing = null;
      runDeferredRefresh();
    });
  return refreshing;
}

function runDeferredRefresh() {
  if (refreshAgain && inFlight === 0 && !refreshing) {
    refreshAgain = false;
    void refreshPlanner();
  }
}

/** 모든 서버 변경은 이 함수를 거친다. job을 부르기 전에 동기적으로 표시해 틈이 생기지 않게 한다. */
async function tracked<T>(job: () => Promise<T>): Promise<T> {
  inFlight++;
  epoch++;
  try {
    return await job();
  } finally {
    inFlight--;
    epoch++;
    runDeferredRefresh();
  }
}

// ─── 변경 ────────────────────────────────────────────────────
function replaceTask(id: string, next: Task) {
  setState({ tasks: state.tasks.map((t) => (t.id === id ? next : t)) });
}

function replaceEvent(id: string, next: CalendarEvent) {
  setState({ events: state.events.map((e) => (e.id === id ? next : e)) });
}

/** 아직 서버에 없는 임시 항목에 대한 변경은 생성이 끝난 뒤에 보낸다. */
const creating = new Map<string, Promise<string>>();
/** 임시 id → 실제 id로 바뀌어도 화면의 행이 다시 그려지지 않도록 처음 id를 key로 유지한다. */
const stableKeys = new Map<string, string>();

export function rowKey(id: string): string {
  return stableKeys.get(id) ?? id;
}

async function realId(id: string): Promise<string> {
  return creating.get(id) ?? id;
}

/** 값을 지우는 변경은 undefined가 JSON에서 사라지지 않도록 null로 보낸다. */
function wirePatch<T extends object>(patch: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));
}

/** 임시 id로 시작한 항목이 저장 후 실제 id를 받아도 같은 항목으로 찾는다. */
function isSameItem(currentId: string, id: string) {
  return currentId === id || stableKeys.get(currentId) === id;
}

let tempCounter = 0;
function tempId() {
  tempCounter += 1;
  return `tmp_${Date.now().toString(36)}_${tempCounter}`;
}

export function addTask(input: { text: string; priority: TaskPriority; due?: string }): Promise<void> {
  const id = tempId();
  const optimistic: Task = {
    id,
    text: input.text,
    priority: input.priority,
    due: input.due,
    done: false,
    createdAt: Date.now(),
  };
  setState({ tasks: [...state.tasks, optimistic] });
  const created = tracked(() => api.post<Task>('/api/tasks', input));
  creating.set(
    id,
    created.then((t) => t.id)
  );
  return created
    .then((saved) => {
      stableKeys.set(saved.id, id);
      // 응답을 기다리는 사이 사용자가 체크했다면 그 변경은 뒤따라 전송되므로 화면 값을 유지한다.
      const current = state.tasks.find((t) => t.id === id);
      replaceTask(id, current ? { ...saved, done: current.done, text: current.text, priority: current.priority, due: current.due } : saved);
    })
    .catch((err) => {
      setState({ tasks: state.tasks.filter((t) => t.id !== id) });
      throw err;
    })
    .finally(() => creating.delete(id));
}

export async function patchTask(id: string, patch: Partial<Task>): Promise<void> {
  const before = state.tasks.find((t) => t.id === id);
  if (!before) return;
  const optimistic: Task = { ...before, ...patch };
  if (patch.done === true) optimistic.completedAt = Date.now();
  if (patch.done === false) delete optimistic.completedAt;
  replaceTask(id, optimistic);
  try {
    const saved = await tracked(async () => api.patch<Task>(`/api/tasks/${await realId(id)}`, wirePatch(patch)));
    setState({ tasks: state.tasks.map((t) => (isSameItem(t.id, id) ? saved : t)) });
  } catch (err) {
    setState({ tasks: state.tasks.map((t) => (isSameItem(t.id, id) ? before : t)) });
    throw err;
  }
}

export async function addEvent(input: EventInput): Promise<void> {
  const id = tempId();
  const optimistic: CalendarEvent = { ...input, id, done: false, createdAt: Date.now() };
  setState({ events: [...state.events, optimistic] });
  try {
    const saved = await tracked(() => api.post<CalendarEvent>('/api/events', input));
    stableKeys.set(saved.id, id);
    replaceEvent(id, saved);
  } catch (err) {
    setState({ events: state.events.filter((e) => e.id !== id) });
    throw err;
  }
}

export async function patchEvent(id: string, patch: Partial<CalendarEvent>): Promise<void> {
  const before = state.events.find((e) => e.id === id);
  if (!before) return;
  replaceEvent(id, { ...before, ...patch });
  try {
    const saved = await tracked(() => api.patch<CalendarEvent>(`/api/events/${id}`, wirePatch(patch)));
    replaceEvent(id, saved);
  } catch (err) {
    replaceEvent(id, before);
    throw err;
  }
}

/**
 * 되돌리기를 살려 두기 위해 삭제 요청을 늦춘다. 앱을 닫으면 바로 보내고,
 * 그 전에 앱이 꺼지면 항목은 그대로 남는다 (지우는 쪽보다 남기는 쪽이 안전하다).
 */
export const UNDO_WINDOW_MS = 6000;

function scheduleDelete<T extends { id: string }>(
  kind: 'task' | 'event',
  item: T,
  url: string,
  restore: (item: T) => void,
  onError: (err: unknown) => void
): () => void {
  const commit = () => {
    pendingDeletes.delete(item.id);
    void tracked(() => api.del(url)).catch((err) => {
      restore(item);
      onError(err);
    });
  };
  const timer = setTimeout(commit, UNDO_WINDOW_MS);
  pendingDeletes.set(item.id, { kind, timer });
  installPagehideFlush();
  return () => {
    const pending = pendingDeletes.get(item.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeletes.delete(item.id);
    restore(item);
  };
}

let pagehideInstalled = false;
function installPagehideFlush() {
  if (pagehideInstalled || typeof window === 'undefined') return;
  pagehideInstalled = true;
  window.addEventListener('pagehide', () => {
    for (const [id, pending] of pendingDeletes) {
      clearTimeout(pending.timer);
      void fetch(`/api/${pending.kind === 'task' ? 'tasks' : 'events'}/${id}`, { method: 'DELETE', keepalive: true }).catch(
        () => undefined
      );
    }
    pendingDeletes.clear();
  });
}

export function removeTaskLater(task: Task, onError: (err: unknown) => void): () => void {
  setState({ tasks: state.tasks.filter((t) => t.id !== task.id) });
  return scheduleDelete(
    'task',
    task,
    `/api/tasks/${task.id}`,
    (item) => setState({ tasks: [...state.tasks, item] }),
    onError
  );
}

export function removeEventLater(event: CalendarEvent, onError: (err: unknown) => void): () => void {
  setState({ events: state.events.filter((e) => e.id !== event.id) });
  return scheduleDelete(
    'event',
    event,
    `/api/events/${event.id}`,
    (item) => setState({ events: [...state.events, item] }),
    onError
  );
}
