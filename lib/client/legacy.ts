import { api } from './api';

const KEYS = { todos: 'illionaire_todos', memo: 'illionaire_memo', schedule: 'illionaire_schedule' } as const;

/**
 * 구버전이 localStorage에 저장한 할 일, 메모, 일정을 로컬 저장소로 한 번만 옮긴다.
 * 서버가 받아들인 뒤에만 원본을 지우므로, 실패하면 다음 실행 때 다시 시도한다.
 */
export async function migrateLegacyStorage(): Promise<void> {
  let body: { todos?: unknown; memo?: string; schedule?: unknown };
  try {
    const todos = localStorage.getItem(KEYS.todos);
    const memo = localStorage.getItem(KEYS.memo);
    const schedule = localStorage.getItem(KEYS.schedule);
    if (!todos && !memo && !schedule) return;
    body = {
      todos: todos ? JSON.parse(todos) : undefined,
      memo: memo ?? undefined,
      schedule: schedule ? JSON.parse(schedule) : undefined,
    };
  } catch {
    return;
  }
  await api.post('/api/data/import', body);
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}
