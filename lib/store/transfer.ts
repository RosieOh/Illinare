import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { CalendarEvent, Task, TaskPriority } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { listAudit } from './audit';
import { listDecks } from './decks';
import { importEvents, listEvents } from './events';
import { dataDir, dataPath, readJson, updateJson } from './json';
import { listMemory } from './memory';
import { getNote, MAX_NOTE, setNote } from './note';
import { listRoutines } from './routines';
import { clearApiKey } from './secrets';
import { getSettings } from './settings';
import { importTasks, listTasks } from './tasks';

/** 데이터 내보내기, 전체 삭제, 구버전 localStorage 이전. 내보내기에는 키를 넣지 않는다. */

const SECRETS_FILE = 'secrets.json';
const LEGACY_MARKER = 'legacy-imported.json';

/** 예전 버전이 처음 실행할 때 넣어 둔 가짜 일정. 사용자의 일정이 아니므로 옮기지 않는다. */
const OLD_SEEDED_SCHEDULE = new Set([
  '09:00 팀 스탠드업',
  '11:00 AI 모델 검토',
  '14:00 클라이언트 미팅',
  '16:00 코드 리뷰',
  '18:30 주간 보고서',
]);

export async function exportAll(): Promise<Record<string, unknown>> {
  const missionsDir = dataPath('missions');
  const missionFiles = await fs.readdir(missionsDir).catch(() => [] as string[]);
  const missions = await Promise.all(
    missionFiles
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson<unknown>(dataPath('missions', f), null))
  );
  const [settings, tasks, events, note, memory, routines, decks, audit] = await Promise.all([
    getSettings(),
    listTasks(),
    listEvents(),
    getNote(),
    listMemory(),
    listRoutines(),
    listDecks(),
    listAudit({ limit: 100000 }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    settings,
    tasks,
    events,
    note,
    memory,
    routines,
    decks,
    audit,
    missions: missions.filter(Boolean),
  };
}

/**
 * 모든 사용자 데이터와 저장된 키를 지운다. 키 파일은 clearApiKey가 OS 저장소의 사본과 함께 지운다.
 * 키를 지우지 못해도 나머지는 지우고 오류를 알린다. 키 파일의 표시가 남아 다시 시도할 수 있다.
 */
export async function deleteAllData(): Promise<void> {
  const entries = await fs.readdir(dataDir()).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name !== SECRETS_FILE)
      .map((name) => fs.rm(dataPath(name), { recursive: true, force: true }))
  );
  await clearApiKey();
}

interface LegacyTodo {
  text?: unknown;
  done?: unknown;
  priority?: unknown;
}

interface LegacySchedule {
  time?: unknown;
  task?: unknown;
  done?: unknown;
  type?: unknown;
}

type LegacyPart = 'todos' | 'memo' | 'schedule';
/** 예전 형식은 true 하나였다. 그때는 전부 옮긴 것이다. */
type LegacyMarker = Partial<Record<LegacyPart, boolean>> | true;

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 같은 입력이면 같은 id. 저장소가 이미 있는 id를 건너뛰므로,
 * 동시에 불리거나 중간에 끊겼다가 다시 불려도 항목이 늘어나지 않는다.
 */
function legacyId(prefix: string, index: number, text: string): string {
  const hash = createHash('sha256').update(`${index}\n${text}`).digest('hex').slice(0, 16);
  return `${prefix}_legacy_${hash}`;
}

function legacyTasks(raw: unknown, now: number): Task[] {
  if (!Array.isArray(raw)) return [];
  return (raw as LegacyTodo[])
    .filter((t) => typeof t?.text === 'string' && t.text.trim() && t.text.length <= 500)
    .map((t, i) => ({
      id: legacyId('task', i, t.text as string),
      text: (t.text as string).trim(),
      done: Boolean(t.done),
      priority: (['high', 'normal', 'low'].includes(t.priority as string) ? t.priority : 'normal') as TaskPriority,
      createdAt: now,
    }));
}

function legacyEvents(raw: unknown, now: number): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  return (raw as LegacySchedule[])
    .filter(
      (s) =>
        typeof s?.task === 'string' &&
        s.task.trim() &&
        s.task.length <= 200 &&
        typeof s.time === 'string' &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) &&
        !OLD_SEEDED_SCHEDULE.has(`${s.time} ${s.task}`)
    )
    .map((s, i) => ({
      id: legacyId('evt', i, `${s.time} ${s.task}`),
      title: (s.task as string).trim(),
      date: todayIso(),
      time: s.time as string,
      kind: s.type === 'meeting' ? 'meeting' : 'work',
      done: Boolean(s.done),
      createdAt: now,
    }));
}

async function markImported(part: LegacyPart): Promise<void> {
  await updateJson<LegacyMarker>(dataPath(LEGACY_MARKER), {}, (current) =>
    current === true ? current : { ...current, [part]: true }
  );
}

/**
 * 구버전 localStorage 데이터를 옮긴다. 부분별로 완료를 기록하므로 다시 불려도 끝난 부분은 건너뛴다.
 * 메모가 너무 길면 나머지를 옮긴 뒤 오류를 낸다. 클라이언트는 성공해야 원본을 지우므로 메모가 사라지지 않는다.
 */
export async function importLegacy(input: { todos?: unknown; memo?: unknown; schedule?: unknown }): Promise<void> {
  const marker = await readJson<LegacyMarker>(dataPath(LEGACY_MARKER), {});
  if (marker === true) return;

  // 먼저 전부 검사하고 나서 쓴다.
  const now = Date.now();
  const tasks = marker.todos ? [] : legacyTasks(input.todos, now);
  const events = marker.schedule ? [] : legacyEvents(input.schedule, now);
  const memo = !marker.memo && typeof input.memo === 'string' && input.memo.trim() ? input.memo : null;
  const memoTooLong = memo !== null && memo.length > MAX_NOTE;

  if (!marker.todos) {
    if (tasks.length) await importTasks(tasks);
    await markImported('todos');
  }
  if (!marker.schedule) {
    if (events.length) await importEvents(events);
    await markImported('schedule');
  }
  if (memoTooLong) {
    throw new ApiError(
      400,
      'memo_too_long',
      `옛 메모가 ${MAX_NOTE.toLocaleString('ko-KR')}자를 넘어 옮기지 못했어요. 할 일과 일정은 옮겼어요. 메모를 줄이면 다음 실행 때 다시 시도해요.`
    );
  }
  if (!marker.memo) {
    if (memo !== null && !(await getNote()).body) await setNote(memo);
    await markImported('memo');
  }
}
