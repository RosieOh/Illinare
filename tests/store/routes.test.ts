import { describe, expect, it } from 'vitest';
import type { AuditEntry, Bootstrap, Deck, MemoryItem, Note, Routine, Settings, SystemSnapshot, Task, ToolInfo } from '@/lib/contracts';
import { GET as getAudit } from '@/app/api/audit/route';
import { POST as undo } from '@/app/api/audit/[id]/undo/route';
import { GET as getBootstrap } from '@/app/api/bootstrap/route';
import { DELETE as deleteData } from '@/app/api/data/route';
import { GET as exportData } from '@/app/api/data/export/route';
import { POST as importData } from '@/app/api/data/import/route';
import { GET as getDecks, POST as postDeck } from '@/app/api/decks/route';
import { DELETE as deleteDeck, GET as getDeck } from '@/app/api/decks/[id]/route';
import { GET as getEvents, POST as postEvent } from '@/app/api/events/route';
import { DELETE as deleteEvent, PATCH as patchEvent } from '@/app/api/events/[id]/route';
import { GET as getMemory, POST as postMemory } from '@/app/api/memory/route';
import { DELETE as deleteMemory } from '@/app/api/memory/[id]/route';
import { GET as getNote, PUT as putNote } from '@/app/api/note/route';
import { GET as getRoutines, POST as postRoutine } from '@/app/api/routines/route';
import { DELETE as deleteRoutine } from '@/app/api/routines/[id]/route';
import { DELETE as deleteKey, PUT as putKey } from '@/app/api/settings/api-key/route';
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/settings/route';
import { GET as getSystem } from '@/app/api/system/route';
import { GET as getTasks, POST as postTask } from '@/app/api/tasks/route';
import { DELETE as deleteTask, PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { GET as getTools } from '@/app/api/tools/route';
import { GET as getWeather } from '@/app/api/weather/route';

const BASE = 'http://127.0.0.1:3000';

function req(path: string, method = 'GET', body?: unknown) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await res).json() as Promise<T>;
}

/** 오류 응답은 항상 { error: { code, message } } 이고 message는 한국어이다. */
async function expectError(res: Promise<Response>, status: number, code?: string) {
  const r = await res;
  expect(r.status).toBe(status);
  const { error } = (await r.json()) as { error: { code: string; message: string } };
  expect(error.message).toMatch(/[가-힣]/);
  if (code) expect(error.code).toBe(code);
}

describe('REST contract', () => {
  it('bootstrap reports demo mode without a key', async () => {
    const b = await json<Bootstrap>(getBootstrap());
    expect(b.mode).toBe('demo');
    expect(b.hasApiKey).toBe(false);
    expect(b.apiKeySource).toBe('none');
    expect(b.brand.name).toBe('일리네어');
    expect(['darwin', 'win32', 'linux']).toContain(b.platform);
    expect(b.dataDir).toBe(process.env.ILLIONAIRE_DATA_DIR);
    expect(b.desktop).toBe(false);
  });

  it('settings round trip and validation', async () => {
    expect((await json<Settings>(getSettings())).theme).toBe('system');
    const patched = await json<Settings>(patchSettings(req('/api/settings', 'PATCH', { theme: 'dark', budgetUsd: 5 })));
    expect(patched.theme).toBe('dark');
    expect(patched.budgetUsd).toBe(5);
    await expectError(patchSettings(req('/api/settings', 'PATCH', { theme: 'neon' })), 400, 'invalid_settings');
  });

  it('rejects malformed JSON with a Korean error', async () => {
    const bad = new Request(`${BASE}/api/settings`, { method: 'PATCH', body: '{nope' });
    await expectError(patchSettings(bad), 400, 'invalid_json');
  });

  it('api key: rejects bad format before any network call, delete is safe', async () => {
    await expectError(putKey(req('/api/settings/api-key', 'PUT', { key: 'short' })), 400, 'invalid_key');
    await expectError(putKey(req('/api/settings/api-key', 'PUT', { key: 'has spaces in the key value here' })), 400, 'invalid_key');
    expect(await json(deleteKey())).toEqual({ ok: true });
  });

  it('tools list carries availability and policy', async () => {
    const { tools } = await json<{ tools: ToolInfo[] }>(getTools());
    expect(tools.length).toBeGreaterThanOrEqual(30);
    const write = tools.find((t) => t.name === 'write_file');
    expect(write).toMatchObject({ risk: 'confirm', group: 'files', policy: 'default', agents: ['archivist'] });
  });

  it('tasks CRUD', async () => {
    const task = await json<Task>(postTask(req('/api/tasks', 'POST', { text: '할 일' })));
    expect(task.priority).toBe('normal');
    const done = await json<Task>(patchTask(req('/api/tasks/x', 'PATCH', { done: true }), ctx(task.id)));
    expect(done.done).toBe(true);
    expect((await json<{ tasks: Task[] }>(getTasks())).tasks.map((t) => t.id)).toContain(task.id);
    await expectError(postTask(req('/api/tasks', 'POST', { text: '' })), 400, 'invalid_task');
    await expectError(patchTask(req('/api/tasks/x', 'PATCH', { done: true }), ctx('missing')), 404, 'not_found');
    expect(await json(deleteTask(req('/api/tasks/x', 'DELETE'), ctx(task.id)))).toEqual({ ok: true });
  });

  it('events CRUD with range query', async () => {
    const event = await json<{ id: string }>(
      postEvent(req('/api/events', 'POST', { title: '회의', date: '2026-12-01', time: '10:00', kind: 'meeting' }))
    );
    const inRange = await json<{ events: { id: string }[] }>(getEvents(req('/api/events?from=2026-12-01&to=2026-12-02')));
    expect(inRange.events.map((e) => e.id)).toContain(event.id);
    const outOfRange = await json<{ events: unknown[] }>(getEvents(req('/api/events?from=2027-01-01')));
    expect(outOfRange.events).toEqual([]);
    await patchEvent(req('/api/events/x', 'PATCH', { done: true }), ctx(event.id));
    await deleteEvent(req('/api/events/x', 'DELETE'), ctx(event.id));
    await expectError(postEvent(req('/api/events', 'POST', { title: '회의', date: '내일' })), 400, 'invalid_event');
  });

  it('note, memory, routines', async () => {
    expect((await json<Note>(putNote(req('/api/note', 'PUT', { body: '메모' })))).body).toBe('메모');
    expect((await json<Note>(getNote())).body).toBe('메모');

    const mem = await json<MemoryItem>(postMemory(req('/api/memory', 'POST', { text: '오전 회의 선호' })));
    expect(mem.source).toBe('user');
    expect((await json<{ items: MemoryItem[] }>(getMemory())).items).toHaveLength(1);
    await deleteMemory(req('/api/memory/x', 'DELETE'), ctx(mem.id));

    const { routines } = await json<{ routines: Routine[] }>(getRoutines());
    expect(routines.length).toBeGreaterThan(0);
    const routine = await json<Routine>(postRoutine(req('/api/routines', 'POST', { title: '회고', goal: '회고 작성' })));
    await deleteRoutine(req('/api/routines/x', 'DELETE'), ctx(routine.id));
  });

  it('decks: sample exists, create, fetch, delete, validate', async () => {
    const { decks } = await json<{ decks: Deck[] }>(getDecks());
    expect(decks.some((d) => d.sample)).toBe(true);
    const deck = await json<Deck>(postDeck(req('/api/decks', 'POST', { title: '자료', slides: [{ type: 'title', title: '제목' }] })));
    expect((await json<Deck>(getDeck(req('/api/decks/x'), ctx(deck.id)))).title).toBe('자료');
    await deleteDeck(req('/api/decks/x', 'DELETE'), ctx(deck.id));
    await expectError(getDeck(req('/api/decks/x'), ctx(deck.id)), 404, 'not_found');
    await expectError(postDeck(req('/api/decks', 'POST', { title: '자료', slides: [] })), 400, 'invalid_deck');
  });

  it('audit list and undo errors', async () => {
    expect(Array.isArray((await json<{ entries: AuditEntry[] }>(getAudit(req('/api/audit?limit=5')))).entries)).toBe(true);
    await expectError(undo(req('/api/audit/x/undo', 'POST'), ctx('missing')), 409, 'undo_failed');
  });

  it('system snapshot matches the contract', async () => {
    const s = await json<SystemSnapshot>(getSystem());
    expect(s.perCore.length).toBeGreaterThan(0);
    expect(s.memTotalGb).toBeGreaterThan(0);
    expect(s.diskTotalGb).toBeGreaterThan(0);
    expect(s.hostname).toBeTruthy();
    if (process.platform === 'win32') expect(s.load1m).toBeNull();
    expect(Array.isArray(s.processes)).toBe(true);
  }, 30000);

  it('weather validates the city before any network call', async () => {
    await expectError(getWeather(req('/api/weather?city=password%3Dhunter2')), 400, 'invalid_city');
  });

  it('import, export, delete', async () => {
    expect(await json(importData(req('/api/data/import', 'POST', { memo: '옛 메모' })))).toEqual({ ok: true });
    const dump = await json<Record<string, unknown>>(exportData());
    expect(dump).toHaveProperty('exportedAt');
    expect(await json(deleteData())).toEqual({ ok: true });
    expect((await json<{ tasks: Task[] }>(getTasks())).tasks).toEqual([]);
  });
});
