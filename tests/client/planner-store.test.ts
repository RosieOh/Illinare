import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, Task } from '@/lib/contracts';

/** 모든 요청을 손으로 끝내는 가짜 API. 응답 순서를 테스트가 정한다. */
interface Pending {
  method: string;
  url: string;
  body?: unknown;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

const pending: Pending[] = [];

function request(method: string) {
  return (url: string, body?: unknown) =>
    new Promise((resolve, reject) => {
      pending.push({ method, url, body, resolve, reject });
    });
}

vi.mock('@/lib/client/api', () => ({
  ClientApiError: class extends Error {},
  api: {
    get: (url: string) => request('GET')(url),
    post: (url: string, body: unknown) => request('POST')(url, body),
    patch: (url: string, body: unknown) => request('PATCH')(url, body),
    del: (url: string) => request('DELETE')(url),
    put: (url: string, body: unknown) => request('PUT')(url, body),
  },
}));

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, text: id, done: false, priority: 'normal', createdAt: 1, ...patch };
}

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

function take(method: string, match: string): Pending {
  const index = pending.findIndex((p) => p.method === method && p.url.includes(match));
  if (index < 0) throw new Error(`요청 없음: ${method} ${match} / 있는 요청: ${pending.map((p) => `${p.method} ${p.url}`).join(', ')}`);
  return pending.splice(index, 1)[0];
}

/** 진행 중인 목록 읽기(할 일 + 일정)에 응답한다. */
async function answerFetch(tasks: Task[], events: CalendarEvent[] = []) {
  take('GET', '/api/tasks').resolve({ tasks });
  take('GET', '/api/events').resolve({ events });
  await flush();
}

const hasFetch = () => pending.some((p) => p.method === 'GET' && p.url.includes('/api/tasks'));

async function loadCore(initial: Task[]) {
  vi.resetModules();
  const core = await import('@/components/planner/core');
  void core.refreshPlanner();
  await answerFetch(initial);
  return core;
}

beforeEach(() => {
  vi.useFakeTimers();
  pending.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('변경 중의 목록 읽기', () => {
  it('PATCH 진행 중에 읽기를 요청해도 체크가 풀리지 않는다', async () => {
    const core = await loadCore([task('a')]);
    const patched = core.patchTask('a', { done: true });
    await flush();
    expect(core.getPlannerState().tasks[0].done).toBe(true);

    void core.refreshPlanner();
    await flush();
    // 낡을 것이 뻔한 읽기는 아예 보내지 않고 변경 뒤로 미룬다.
    expect(hasFetch()).toBe(false);
    expect(core.getPlannerState().tasks[0].done).toBe(true);

    take('PATCH', '/api/tasks/a').resolve(task('a', { done: true }));
    await patched;
    await flush();
    expect(hasFetch()).toBe(true);
    await answerFetch([task('a', { done: true })]);
    expect(core.getPlannerState().tasks[0].done).toBe(true);
  });

  it('읽는 도중 시작한 PATCH가 끝나기 전에 응답이 와도 버린다', async () => {
    const core = await loadCore([task('a')]);
    void core.refreshPlanner();
    await flush();
    const patched = core.patchTask('a', { done: true });
    await flush();
    await answerFetch([task('a', { done: false })]); // 체크 전의 낡은 목록
    expect(core.getPlannerState().tasks[0].done).toBe(true);

    take('PATCH', '/api/tasks/a').resolve(task('a', { done: true }));
    await patched;
    await flush();
    await answerFetch([task('a', { done: true })]);
    expect(core.getPlannerState().tasks[0].done).toBe(true);
  });

  it('PATCH가 끝난 뒤에 도착한 낡은 응답도 버리고 다시 읽는다', async () => {
    const core = await loadCore([task('a')]);
    void core.refreshPlanner();
    await flush();
    const patched = core.patchTask('a', { done: true });
    await flush();
    take('PATCH', '/api/tasks/a').resolve(task('a', { done: true }));
    await patched;
    await answerFetch([task('a', { done: false })]);
    expect(core.getPlannerState().tasks[0].done).toBe(true);
    expect(hasFetch()).toBe(true);
    await answerFetch([task('a', { done: true })]);
    expect(core.getPlannerState().tasks[0].done).toBe(true);
    expect(hasFetch()).toBe(false);
  });

  it('DELETE 진행 중에 읽어도 지운 항목이 유령으로 돌아오지 않는다', async () => {
    const core = await loadCore([task('ghost'), task('keep')]);
    core.removeTaskLater(task('ghost'), () => undefined);
    await vi.advanceTimersByTimeAsync(core.UNDO_WINDOW_MS);
    const del = take('DELETE', '/api/tasks/ghost');

    void core.refreshPlanner();
    await flush();
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['keep']);

    del.resolve({ ok: true });
    await flush();
    await answerFetch([task('keep')]);
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['keep']);
  });

  it('DELETE 전에 시작한 읽기가 DELETE 중에 도착해도 유령이 생기지 않는다', async () => {
    const core = await loadCore([task('ghost'), task('keep')]);
    core.removeTaskLater(task('ghost'), () => undefined);
    await vi.advanceTimersByTimeAsync(core.UNDO_WINDOW_MS - 1);
    void core.refreshPlanner();
    await flush();
    await vi.advanceTimersByTimeAsync(1);
    const del = take('DELETE', '/api/tasks/ghost');
    await answerFetch([task('ghost'), task('keep')]);
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['keep']);
    del.resolve({ ok: true });
    await flush();
    await answerFetch([task('keep')]);
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['keep']);
  });

  it('되돌리기 시간 안에 읽어도 지운 항목을 숨긴다', async () => {
    const core = await loadCore([task('a'), task('b')]);
    core.removeTaskLater(task('a'), () => undefined);
    void core.refreshPlanner();
    await flush();
    await answerFetch([task('a'), task('b')]);
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('변경이 없을 때의 읽기는 그대로 반영한다 (에이전트가 바꾼 항목)', async () => {
    const core = await loadCore([task('a')]);
    void core.refreshPlanner();
    await flush();
    await answerFetch([task('a'), task('from-agent')]);
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['a', 'from-agent']);
  });

  it('변경이 여럿이면 마지막 변경이 끝난 뒤에 읽는다', async () => {
    const core = await loadCore([task('a'), task('b')]);
    const p1 = core.patchTask('a', { done: true });
    const p2 = core.patchTask('b', { done: true });
    await flush();
    void core.refreshPlanner();
    take('PATCH', '/api/tasks/a').resolve(task('a', { done: true }));
    await p1;
    await flush();
    expect(hasFetch()).toBe(false);
    take('PATCH', '/api/tasks/b').resolve(task('b', { done: true }));
    await p2;
    await flush();
    expect(hasFetch()).toBe(true);
  });
});

describe('실패와 되돌리기', () => {
  it('PATCH가 실패하면 그 항목만 되돌리고 미뤄 둔 읽기를 보낸다', async () => {
    const core = await loadCore([task('a'), task('b')]);
    const patched = core.patchTask('a', { done: true });
    await flush();
    void core.refreshPlanner();
    take('PATCH', '/api/tasks/a').reject(new Error('실패'));
    await expect(patched).rejects.toThrow('실패');
    await flush();
    expect(core.getPlannerState().tasks.find((t) => t.id === 'a')?.done).toBe(false);
    expect(hasFetch()).toBe(true);
  });

  it('DELETE가 실패하면 항목을 복원하고 알린다', async () => {
    const core = await loadCore([task('a')]);
    const onError = vi.fn();
    core.removeTaskLater(task('a'), onError);
    await vi.advanceTimersByTimeAsync(core.UNDO_WINDOW_MS);
    take('DELETE', '/api/tasks/a').reject(new Error('실패'));
    await flush();
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['a']);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('되돌리면 DELETE를 보내지 않는다', async () => {
    const core = await loadCore([task('a')]);
    const undo = core.removeTaskLater(task('a'), () => undefined);
    expect(core.getPlannerState().tasks).toEqual([]);
    undo();
    expect(core.getPlannerState().tasks.map((t) => t.id)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(core.UNDO_WINDOW_MS * 2);
    expect(pending.some((p) => p.method === 'DELETE')).toBe(false);
  });
});

describe('임시 항목', () => {
  it('저장 중인 새 항목은 읽기 결과에 밀려 사라지지 않고 체크도 이어진다', async () => {
    const core = await loadCore([]);
    const added = core.addTask({ text: '새 일', priority: 'normal' });
    const tempId = core.getPlannerState().tasks[0].id;
    expect(core.isTemp(tempId)).toBe(true);
    const checked = core.patchTask(tempId, { done: true });
    await flush();
    take('POST', '/api/tasks').resolve(task('real', { text: '새 일' }));
    await added;
    await flush();
    expect(core.getPlannerState().tasks[0]).toMatchObject({ id: 'real', done: true });
    expect(core.rowKey('real')).toBe(tempId);
    take('PATCH', '/api/tasks/real').resolve(task('real', { text: '새 일', done: true }));
    await checked;
    await flush();
    expect(core.getPlannerState().tasks).toHaveLength(1);
    expect(core.getPlannerState().tasks[0].done).toBe(true);
  });
});
