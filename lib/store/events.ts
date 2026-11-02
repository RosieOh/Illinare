import type { CalendarEvent } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, newId, readJson, updateJson } from './json';
import { isIsoDate } from './tasks';

const file = () => dataPath('events.json');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: CalendarEvent['kind'][] = ['work', 'meeting', 'personal'];

function bad(message: string): ApiError {
  return new ApiError(400, 'invalid_event', message);
}

function assertTitle(title: unknown): string {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || trimmed.length > 200) throw bad('일정 제목은 1~200자여야 해요.');
  return trimmed;
}

function sortKey(e: CalendarEvent): string {
  return `${e.date} ${e.time ?? '00:00'}`;
}

export async function listEvents(range: { from?: string | null; to?: string | null } = {}): Promise<CalendarEvent[]> {
  const events = await readJson<CalendarEvent[]>(file(), []);
  return events
    .filter((e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export async function addEvent(input: {
  title: unknown;
  date: unknown;
  time?: unknown;
  durationMin?: unknown;
  kind?: unknown;
  missionId?: string;
}): Promise<CalendarEvent> {
  if (!isIsoDate(input.date)) throw bad('날짜는 YYYY-MM-DD 형식이어야 해요.');
  const event: CalendarEvent = {
    id: newId('evt'),
    title: assertTitle(input.title),
    date: input.date,
    kind: KINDS.includes(input.kind as CalendarEvent['kind']) ? (input.kind as CalendarEvent['kind']) : 'work',
    done: false,
    createdAt: Date.now(),
  };
  if (input.time !== undefined && input.time !== null && input.time !== '') {
    if (typeof input.time !== 'string' || !TIME_RE.test(input.time)) throw bad('시간은 HH:mm 형식이어야 해요.');
    event.time = input.time;
  }
  if (input.durationMin !== undefined && input.durationMin !== null) {
    const d = input.durationMin;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0 || d > 1440) throw bad('소요 시간이 올바르지 않아요.');
    event.durationMin = Math.round(d);
  }
  if (input.missionId) event.missionId = input.missionId;
  await updateJson<CalendarEvent[]>(file(), [], (events) => [...events, event]);
  return event;
}

export async function patchEvent(id: string, patch: Record<string, unknown>): Promise<CalendarEvent> {
  let updated: CalendarEvent | undefined;
  await updateJson<CalendarEvent[]>(file(), [], (events) =>
    events.map((e) => {
      if (e.id !== id) return e;
      const next: CalendarEvent = { ...e };
      if ('title' in patch) next.title = assertTitle(patch.title);
      if ('date' in patch) {
        if (!isIsoDate(patch.date)) throw bad('날짜는 YYYY-MM-DD 형식이어야 해요.');
        next.date = patch.date;
      }
      if ('time' in patch) {
        if (patch.time === null || patch.time === '') delete next.time;
        else if (typeof patch.time === 'string' && TIME_RE.test(patch.time)) next.time = patch.time;
        else throw bad('시간은 HH:mm 형식이어야 해요.');
      }
      if ('durationMin' in patch) {
        if (patch.durationMin === null) delete next.durationMin;
        else if (typeof patch.durationMin === 'number' && patch.durationMin > 0 && patch.durationMin <= 1440) {
          next.durationMin = Math.round(patch.durationMin);
        } else throw bad('소요 시간이 올바르지 않아요.');
      }
      if ('kind' in patch) {
        if (!KINDS.includes(patch.kind as CalendarEvent['kind'])) throw bad('일정 종류가 올바르지 않아요.');
        next.kind = patch.kind as CalendarEvent['kind'];
      }
      if ('done' in patch) next.done = Boolean(patch.done);
      updated = next;
      return next;
    })
  );
  if (!updated) throw new ApiError(404, 'not_found', '일정을 찾을 수 없어요.');
  return updated;
}

export async function removeEvent(id: string): Promise<void> {
  let found = false;
  await updateJson<CalendarEvent[]>(file(), [], (events) => {
    found = events.some((e) => e.id === id);
    return events.filter((e) => e.id !== id);
  });
  if (!found) throw new ApiError(404, 'not_found', '일정을 찾을 수 없어요.');
}

/** 구버전 데이터 이전 전용. 같은 id가 이미 있으면 건너뛴다. */
export async function importEvents(events: CalendarEvent[]): Promise<void> {
  await updateJson<CalendarEvent[]>(file(), [], (current) => {
    const known = new Set(current.map((e) => e.id));
    return [...current, ...events.filter((e) => !known.has(e.id))];
  });
}
