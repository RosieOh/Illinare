import { mkdirSync, mkdtempSync, promises as fs, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, listAudit, markUndone } from '@/lib/store/audit';
import { addDeck, listDecks, parseSlides, removeDeck } from '@/lib/store/decks';
import { addEvent, listEvents, patchEvent, removeEvent } from '@/lib/store/events';
import { captureBefore, commitJournal, restoreJournal } from '@/lib/store/journal';
import { dataDir, dataPath, readJson, updateJson, writeJson } from '@/lib/store/json';
import { addMemory, listMemory, removeMemory } from '@/lib/store/memory';
import { getNote, setNote } from '@/lib/store/note';
import { addRoutine, listRoutines, removeRoutine } from '@/lib/store/routines';
import { apiKeyInfo, clearApiKey, getApiKey, setApiKey } from '@/lib/store/secrets';
import { getSettings, patchSettings, sanitizeSettingsPatch, setToolPolicy } from '@/lib/store/settings';
import { addTask, isIsoDate, listTasks, patchTask, removeTask } from '@/lib/store/tasks';
import { deleteAllData, exportAll, importLegacy } from '@/lib/store/transfer';

describe('json store', () => {
  it('does not lose updates under concurrent read-modify-write', async () => {
    const file = dataPath('concurrency.json');
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => updateJson<number[]>(file, [], (list) => [...list, i]))
    );
    const list = await readJson<number[]>(file, []);
    expect(list).toHaveLength(50);
    expect(new Set(list).size).toBe(50);
  }, 60000);

  it('keeps the file valid during concurrent writes and reads', async () => {
    const file = dataPath('atomic.json');
    await writeJson(file, { n: -1, pad: 'x'.repeat(20000) });
    let torn = 0;
    const reader = (async () => {
      for (let i = 0; i < 60; i++) {
        const raw = await fs.readFile(file, 'utf8').catch(() => null);
        if (raw !== null) {
          try {
            JSON.parse(raw);
          } catch {
            torn++;
          }
        }
      }
    })();
    await Promise.all(Array.from({ length: 30 }, (_, n) => writeJson(file, { n, pad: 'x'.repeat(20000) })));
    await reader;
    expect(torn).toBe(0);
  }, 60000);

  it('leaves no temp files behind', async () => {
    const entries = await fs.readdir(dataDir());
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('moves a corrupt file aside instead of overwriting it', async () => {
    const file = dataPath('corrupt.json');
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(file, '{ not json');
    expect(await readJson(file, 'fallback')).toBe('fallback');
    const entries = await fs.readdir(dataDir());
    expect(entries.some((e) => e.startsWith('corrupt.json.corrupt-'))).toBe(true);
  });
});

describe('settings', () => {
  it('merges defaults and persists patches', async () => {
    expect((await getSettings()).modelPreset).toBe('best');
    await patchSettings({ displayName: '로지' });
    expect((await getSettings()).displayName).toBe('로지');
    await setToolPolicy('write_file', 'allow');
    expect((await getSettings()).toolPolicies.write_file).toBe('allow');
    await setToolPolicy('write_file', 'default');
    expect((await getSettings()).toolPolicies.write_file).toBeUndefined();
  });

  it('sanitizes REST patches', () => {
    expect(sanitizeSettingsPatch({ theme: 'dark', hacker: true })).toEqual({ theme: 'dark' });
    expect(() => sanitizeSettingsPatch({ theme: 'neon' })).toThrow();
    expect(() => sanitizeSettingsPatch({ budgetUsd: -1 })).toThrow();
    expect(() => sanitizeSettingsPatch({ modelPreset: 'gpt' })).toThrow();
    expect(() => sanitizeSettingsPatch({ toolPolicies: { a: 'yolo' } })).toThrow();
    expect(() => sanitizeSettingsPatch([])).toThrow();
    expect(sanitizeSettingsPatch({ toolPolicies: { a: 'allow', b: 'default' } })).toEqual({ toolPolicies: { a: 'allow' } });
  });
});

describe('secrets', () => {
  it('stores, masks, and clears the key; env wins', async () => {
    expect(await getApiKey()).toBeNull();
    expect((await apiKeyInfo()).source).toBe('none');

    const hint = await setApiKey('sk-ant-test-key-1234567890');
    expect(hint).toBe('sk-ant-…7890');
    expect(await getApiKey()).toBe('sk-ant-test-key-1234567890');
    expect(await apiKeyInfo()).toEqual({ hasApiKey: true, source: 'stored', hint });

    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env-0000';
    try {
      expect(await getApiKey()).toBe('sk-ant-from-env-0000');
      expect((await apiKeyInfo()).source).toBe('env');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (process.platform !== 'win32') {
      const stat = await fs.stat(dataPath('secrets.json'));
      expect(stat.mode & 0o077).toBe(0);
    }
    await clearApiKey();
    expect(await getApiKey()).toBeNull();
  });
});

describe('planner stores', () => {
  it('tasks: add, patch, remove, validate', async () => {
    const task = await addTask({ text: '  보고서  ', priority: 'high', due: '2026-12-01' });
    expect(task.text).toBe('보고서');
    const done = await patchTask(task.id, { done: true });
    expect(done.done).toBe(true);
    expect(done.completedAt).toBeGreaterThan(0);
    expect((await patchTask(task.id, { done: false })).completedAt).toBeUndefined();
    expect((await patchTask(task.id, { due: null })).due).toBeUndefined();
    await expect(addTask({ text: '' })).rejects.toThrow();
    await expect(addTask({ text: 'x', due: '내일' })).rejects.toThrow();
    await expect(patchTask('nope', { done: true })).rejects.toThrow(/찾을 수 없/);
    await removeTask(task.id);
    expect((await listTasks()).some((t) => t.id === task.id)).toBe(false);
  });

  it('events: sorted, range-filtered, validated', async () => {
    const b = await addEvent({ title: '오후', date: '2026-12-01', time: '15:00' });
    const a = await addEvent({ title: '오전', date: '2026-12-01', time: '09:00', kind: 'meeting' });
    const c = await addEvent({ title: '다음 날', date: '2026-12-02' });
    expect((await listEvents({ from: '2026-12-01', to: '2026-12-01' })).map((e) => e.title)).toEqual(['오전', '오후']);
    expect((await patchEvent(a.id, { time: null })).time).toBeUndefined();
    await expect(addEvent({ title: 'x', date: '2026-12-01', time: '25:00' })).rejects.toThrow();
    await expect(addEvent({ title: 'x', date: 'soon' })).rejects.toThrow();
    await Promise.all([removeEvent(a.id), removeEvent(b.id), removeEvent(c.id)]);
  });

  it('note, memory, and routines round trip', async () => {
    expect((await setNote('메모')).body).toBe('메모');
    expect((await getNote()).body).toBe('메모');

    const mem = await addMemory('회의는 오전을 선호', 'agent');
    expect(mem.source).toBe('agent');
    expect((await listMemory()).map((m) => m.id)).toContain(mem.id);
    await removeMemory(mem.id);

    const seeded = await listRoutines();
    expect(seeded.length).toBeGreaterThan(0);
    const routine = await addRoutine({ title: '주간 회고', goal: '이번 주 회고를 작성해 주세요' });
    await removeRoutine(routine.id);
    // 지운 기본 루틴이 다시 생기지 않는다.
    for (const r of seeded) await removeRoutine(r.id);
    expect(await listRoutines()).toEqual([]);
  });
});

describe('decks', () => {
  it('seeds one honest sample and keeps user decks first', async () => {
    const decks = await listDecks();
    const samples = decks.filter((d) => d.sample);
    expect(samples).toHaveLength(1);
    expect(samples[0].title).toContain('예시');
    const text = JSON.stringify(samples[0]);
    // 이전 슬라이드에 있던 지어낸 지표가 없어야 한다.
    for (const fake of ['TFLOPS', '99.97', 'NPS', '양자', 'AES']) expect(text).not.toContain(fake);

    const deck = await addDeck({ title: '새 자료', slides: [{ type: 'title', title: '안녕' }] });
    expect((await listDecks())[0].id).toBe(deck.id);
    await removeDeck(deck.id);
  });

  it('parseSlides keeps known fields and rejects malformed slides', () => {
    expect(
      parseSlides([
        { type: 'title', title: 'a', subtitle: 'b', note: 'n', junk: 1 },
        { type: 'quote', quote: 'q' },
        { type: 'stats', title: 's', stats: [{ label: 'l', value: '1' }] },
        { type: 'timeline', title: 't', items: [{ when: 'w', what: 'x' }] },
        { type: 'closing', title: 'c' },
      ])[0]
    ).toEqual({ type: 'title', title: 'a', subtitle: 'b', note: 'n' });
    expect(() => parseSlides([])).toThrow();
    expect(() => parseSlides([{ type: 'bullets', title: 'x', bullets: [] }])).toThrow(/1번 슬라이드/);
    expect(() => parseSlides([{ type: 'bars', title: 'x', bars: [{ label: 'a', value: 'high' }] }])).toThrow(/숫자/);
    expect(() => parseSlides([{ type: 'nope' }])).toThrow(/알 수 없는/);
  });
});

describe('audit', () => {
  it('reads newest first, filters, and applies undo records', async () => {
    const first = await appendAudit({ missionId: 'a1', tool: 't1', summary: 's', risk: 'safe', status: 'ok', approvedBy: 'auto', journalId: 'j1' });
    await new Promise((r) => setTimeout(r, 2));
    const second = await appendAudit({ missionId: 'a1', tool: 't2', summary: 's', risk: 'safe', status: 'ok', approvedBy: 'auto' });
    const listed = await listAudit({ missionId: 'a1' });
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(listed[1].undoable).toBe(true);
    expect(listed[0].undoable).toBe(false);
    expect(JSON.stringify(listed)).not.toContain('journalId');

    await markUndone(first.id);
    const after = await listAudit({ missionId: 'a1' });
    expect(after[1].undoable).toBe(false);
    expect(after[1].undoneAt).toBeGreaterThan(0);
    expect(await listAudit({ limit: 1 })).toHaveLength(1);
  });
});

describe('journal', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const savedHome = process.env[homeKey];
  let root: string;
  const file = () => join(root, 'Documents', 'journal-subject.txt');

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'illionaire-journal-')));
    mkdirSync(join(root, 'Documents'), { recursive: true });
    process.env[homeKey] = root;
  });

  afterAll(() => {
    process.env[homeKey] = savedHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('restores an overwritten file', async () => {
    await fs.writeFile(file(), 'before');
    const id = (await captureBefore(file(), 'write'))!;
    await fs.writeFile(file(), 'after');
    await commitJournal(id);
    await restoreJournal(id);
    expect(await fs.readFile(file(), 'utf8')).toBe('before');
    await expect(restoreJournal(id)).rejects.toThrow(/되돌리기 정보가 없어요/);
  });

  it('removes a file the change created', async () => {
    await fs.rm(file(), { force: true });
    const id = (await captureBefore(file(), 'write'))!;
    await fs.writeFile(file(), 'new');
    await commitJournal(id);
    await restoreJournal(id);
    await expect(fs.stat(file())).rejects.toThrow();
  });

  it('restores a deleted file and refuses when the path is reoccupied', async () => {
    await fs.writeFile(file(), 'keep me');
    const id = (await captureBefore(file(), 'delete'))!;
    await fs.rm(file());
    await commitJournal(id);
    await restoreJournal(id);
    expect(await fs.readFile(file(), 'utf8')).toBe('keep me');

    const again = (await captureBefore(file(), 'delete'))!;
    await fs.rm(file());
    await commitJournal(again);
    await fs.writeFile(file(), 'someone else');
    await expect(restoreJournal(again)).rejects.toThrow(/새 파일/);
    expect(await fs.readFile(file(), 'utf8')).toBe('someone else');
  });

  it('refuses when the file changed after the tool wrote it', async () => {
    await fs.writeFile(file(), 'v1');
    const id = (await captureBefore(file(), 'write'))!;
    await fs.writeFile(file(), 'v2');
    await commitJournal(id);
    await fs.writeFile(file(), 'v3');
    await expect(restoreJournal(id)).rejects.toThrow(/바뀌어/);
    expect(await fs.readFile(file(), 'utf8')).toBe('v3');
  });
});

describe('transfer', () => {
  it('imports legacy data once and skips the old fake schedule', async () => {
    await setNote('');
    const beforeTasks = (await listTasks()).length;
    const legacy = {
      todos: [{ id: 1, text: '옛 할 일', done: false, priority: 'high' }, { id: 2, text: '' }],
      memo: '옛 메모',
      schedule: [
        { id: 1, time: '09:00', task: '팀 스탠드업', done: false, type: 'meeting' },
        { id: 2, time: '10:30', task: '치과 예약', done: false, type: 'work' },
      ],
    };
    await importLegacy(legacy);
    await importLegacy(legacy);
    expect((await listTasks()).length).toBe(beforeTasks + 1);
    expect((await getNote()).body).toBe('옛 메모');
    const titles = (await listEvents()).map((e) => e.title);
    expect(titles).toContain('치과 예약');
    expect(titles).not.toContain('팀 스탠드업');
  });

  it('exports without the key and deletes everything but the key', async () => {
    await setApiKey('sk-ant-test-key-1234567890');
    const dump = await exportAll();
    expect(JSON.stringify(dump)).not.toContain('sk-ant-test');
    expect(dump).toHaveProperty('tasks');

    await deleteAllData();
    expect(await listTasks()).toEqual([]);
    expect(await getApiKey()).toBe('sk-ant-test-key-1234567890');
    await clearApiKey();
  });
});

describe('날짜 검증', () => {
  it('달력에 없는 날짜를 거부한다', async () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-1-1', 'soon']) {
      expect(isIsoDate(bad), bad).toBe(false);
    }
    await expect(addTask({ text: 'x', due: '2026-02-31' })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(addEvent({ title: 'x', date: '2026-02-31' })).rejects.toThrow(/YYYY-MM-DD/);
    const task = await addTask({ text: 'x' });
    await expect(patchTask(task.id, { due: '2026-04-31' })).rejects.toThrow(/YYYY-MM-DD/);
    await removeTask(task.id);
  });
});

describe('구버전 데이터 이전', () => {
  it('재현: 메모가 너무 길어도 실행할 때마다 할 일이 늘어나지 않는다', async () => {
    await deleteAllData();
    const legacy = { todos: [{ text: '옛날 할 일' }], schedule: [{ time: '10:00', task: '치과' }], memo: 'x'.repeat(200_001) };
    for (let launch = 0; launch < 3; launch++) {
      await expect(importLegacy(legacy)).rejects.toThrow(/메모가/);
      expect((await listTasks()).length).toBe(1);
      expect((await listEvents()).length).toBe(1);
    }
    // 메모를 줄이면 메모만 옮긴다.
    await importLegacy({ ...legacy, memo: '짧은 메모' });
    expect((await listTasks()).length).toBe(1);
    expect((await listEvents()).length).toBe(1);
    expect((await getNote()).body).toBe('짧은 메모');
  });

  it('재현: 동시에 불려도 항목이 늘어나지 않는다', async () => {
    await deleteAllData();
    const legacy = { todos: [{ text: 'a' }, { text: 'b' }], schedule: [{ time: '10:00', task: '치과' }], memo: '메모' };
    await Promise.all([importLegacy(legacy), importLegacy(legacy), importLegacy(legacy)]);
    expect((await listTasks()).map((t) => t.text).sort()).toEqual(['a', 'b']);
    expect((await listEvents()).length).toBe(1);
    expect((await getNote()).body).toBe('메모');
  });

  it('완료 표시 뒤에는 다시 옮기지 않는다. 지운 항목이 되살아나지 않는다', async () => {
    await deleteAllData();
    const legacy = { todos: [{ text: 'a' }] };
    await importLegacy(legacy);
    const [task] = await listTasks();
    await removeTask(task.id);
    await importLegacy(legacy);
    expect(await listTasks()).toEqual([]);
  });

  it('예전 형식의 완료 표시를 존중한다', async () => {
    await deleteAllData();
    await writeJson(dataPath('legacy-imported.json'), true);
    await importLegacy({ todos: [{ text: 'a' }], memo: 'x'.repeat(200_001) });
    expect(await listTasks()).toEqual([]);
  });
});
