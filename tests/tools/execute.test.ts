import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '@/lib/store/audit';
import { executeTool, recordDenied, undoAudit } from '@/lib/tools/execute';
import { getTool } from '@/lib/tools';
import { isPlausibleCity } from '@/lib/tools/weather';

const meta = { approvedBy: 'user' as const, tainted: false };

describe('executeTool', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const savedHome = process.env[homeKey];
  let home: string;
  let desktop: string;

  beforeAll(() => {
    home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'illionaire-exec-')));
    desktop = path.join(home, 'Desktop');
    mkdirSync(desktop, { recursive: true });
    process.env[homeKey] = home;
  });

  afterAll(() => {
    process.env[homeKey] = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('never throws on unknown tools or bad input, and audits them', async () => {
    const unknown = await executeTool('no_such_tool', {}, {}, meta);
    expect(unknown.status).toBe('error');
    expect(unknown.content).toMatch(/알 수 없는 도구/);

    const invalid = await executeTool('set_volume', { level: 'loud' }, {}, meta);
    expect(invalid.status).toBe('error');
    expect(invalid.content).toMatch(/입력 검증 실패/);
    expect(invalid.auditId).toBeTruthy();
  });

  it('turns thrown errors into error results', async () => {
    const res = await executeTool('read_file', { path: '~/../../outside.txt' }, {}, meta);
    expect(res.status).toBe('error');
    expect(res.content).toMatch(/밖의 경로/);
  });

  it('write_file then undo restores the original content', async () => {
    const file = path.join(desktop, 'doc.txt');
    writeFileSync(file, 'original');
    const res = await executeTool('write_file', { path: '~/Desktop/doc.txt', content: 'changed' }, { missionId: 'm1', agent: 'archivist' }, meta);
    expect(res.status).toBe('ok');
    expect(res.undoId).toBe(res.auditId);
    expect(readFileSync(file, 'utf8')).toBe('changed');

    const { message } = await undoAudit(res.undoId!);
    expect(message).toMatch(/되돌렸어요/);
    expect(readFileSync(file, 'utf8')).toBe('original');

    await expect(undoAudit(res.undoId!)).rejects.toThrow(/이미 되돌린/);
    const entries = await listAudit({ missionId: 'm1' });
    const entry = entries.find((e) => e.id === res.auditId);
    expect(entry?.undoable).toBe(false);
    expect(entry?.undoneAt).toBeGreaterThan(0);
  });

  it('undo of a newly created file removes it', async () => {
    const file = path.join(desktop, 'created', 'new.txt');
    const res = await executeTool('write_file', { path: '~/Desktop/created/new.txt', content: 'x' }, {}, meta);
    expect(existsSync(file)).toBe(true);
    await undoAudit(res.undoId!);
    expect(existsSync(file)).toBe(false);
  });

  it('append_file undo restores the previous content', async () => {
    const file = path.join(desktop, 'log.txt');
    writeFileSync(file, 'a');
    const res = await executeTool('append_file', { path: '~/Desktop/log.txt', content: 'b' }, {}, meta);
    expect(readFileSync(file, 'utf8')).toBe('ab');
    await undoAudit(res.undoId!);
    expect(readFileSync(file, 'utf8')).toBe('a');
  });

  it('refuses to undo when the file changed afterwards', async () => {
    const file = path.join(desktop, 'edited.txt');
    writeFileSync(file, 'v1');
    const res = await executeTool('write_file', { path: '~/Desktop/edited.txt', content: 'v2' }, {}, meta);
    writeFileSync(file, 'v3 by the user');
    await expect(undoAudit(res.undoId!)).rejects.toThrow(/바뀌어/);
    expect(readFileSync(file, 'utf8')).toBe('v3 by the user');
  });

  it('write_file refuses protected and persistence paths', async () => {
    const env = await executeTool('write_file', { path: '~/.env', content: 'x' }, {}, meta);
    expect(env.status).toBe('error');
    expect(env.content).toMatch(/보호된 경로/);
    const rc = await executeTool('write_file', { path: '~/.bashrc', content: 'x' }, {}, meta);
    expect(rc.status).toBe('error');
    expect(rc.content).toMatch(/바탕 화면, 문서/);
    expect(existsSync(path.join(home, '.bashrc'))).toBe(false);
  });

  it('write_file preview shows before and after', async () => {
    writeFileSync(path.join(desktop, 'p.txt'), 'old text');
    const preview = await getTool('write_file')!.preview!({ path: '~/Desktop/p.txt', content: 'new text' });
    expect(preview).toMatchObject({ kind: 'diff', before: 'old text', after: 'new text', truncated: false });
    const missing = await getTool('write_file')!.preview!({ path: '~/Desktop/none.txt', content: 'n' });
    expect(missing?.before).toBe('');
  });

  it('read_file risk depends on the folder', () => {
    const riskFor = getTool('read_file')!.riskFor!;
    expect(riskFor({ path: '~/Desktop/a.txt' })).toBe('safe');
    expect(riskFor({ path: '~/project/a.txt' })).toBe('confirm');
  });

  it('list_files hides protected and hidden entries; read_file refuses binary content', async () => {
    writeFileSync(path.join(desktop, '.env'), 'SECRET=1');
    writeFileSync(path.join(desktop, 'visible.txt'), 'v');
    const listed = await executeTool('list_files', { path: '~/Desktop' }, {}, meta);
    expect(listed.content).toContain('visible.txt');
    expect(listed.content).not.toContain('.env');

    writeFileSync(path.join(desktop, 'bin.dat'), Buffer.from([1, 0, 2, 0]));
    const bin = await executeTool('read_file', { path: '~/Desktop/bin.dat' }, {}, meta);
    expect(bin.content).toMatch(/바이너리/);
  });

  it('search_files finds by name without leaking protected files', async () => {
    writeFileSync(path.join(desktop, 'quarterly report.md'), 'x');
    mkdirSync(path.join(home, '.ssh'), { recursive: true });
    writeFileSync(path.join(home, '.ssh', 'report.md'), 'x');
    if (process.platform === 'darwin') return; // mdfind를 쓰는 OS는 색인에 의존한다.
    const res = await executeTool('search_files', { query: 'report' }, {}, meta);
    expect(res.content).toContain('quarterly report.md');
    expect(res.content).not.toContain('.ssh');
  });

  it('does not store file contents in the audit log', async () => {
    writeFileSync(path.join(desktop, 'private.txt'), 'TOP-SECRET-CONTENT');
    const res = await executeTool('read_file', { path: '~/Desktop/private.txt' }, { missionId: 'm-private' }, meta);
    expect(res.content).toContain('TOP-SECRET-CONTENT');
    const [entry] = await listAudit({ missionId: 'm-private' });
    expect(JSON.stringify(entry)).not.toContain('TOP-SECRET-CONTENT');
  });

  it('planner tools write to the store and emit artifacts', async () => {
    const artifacts: unknown[] = [];
    const ctx = { missionId: 'm2', emitArtifact: (a: unknown) => artifacts.push(a) };
    const added = await executeTool('add_task', { text: '보고서 쓰기', priority: 'high', due: '2026-12-01' }, ctx, meta);
    expect(added.status).toBe('ok');
    const listed = await executeTool('list_tasks', {}, ctx, meta);
    expect(listed.content).toContain('보고서 쓰기');
    const event = await executeTool('add_event', { title: '회의', date: '2026-12-01', time: '15:00' }, ctx, meta);
    expect(event.status).toBe('ok');
    expect(artifacts).toHaveLength(2);
    const wrong = await executeTool('add_event', { title: '회의', date: '내일' }, ctx, meta);
    expect(wrong.status).toBe('error');
    expect(wrong.content).toMatch(/YYYY-MM-DD/);
  });

  it('create_deck validates the slide union', async () => {
    const artifacts: { kind: string }[] = [];
    const ok = await executeTool(
      'create_deck',
      {
        title: '분기 보고',
        slides: [
          { type: 'title', title: '제목' },
          { type: 'bullets', title: '요점', bullets: ['하나'] },
          { type: 'bars', title: '막대', bars: [{ label: 'a', value: 1, target: 2, unit: '%' }] },
        ],
      },
      { emitArtifact: (a) => artifacts.push(a) },
      meta
    );
    expect(ok.status).toBe('ok');
    expect(artifacts[0].kind).toBe('deck');

    const bad = await executeTool('create_deck', { title: 't', slides: [{ type: 'bullets', title: '요점' }] }, {}, meta);
    expect(bad.status).toBe('error');
    expect(bad.content).toMatch(/1번 슬라이드/);
    const unknown = await executeTool('create_deck', { title: 't', slides: [{ type: 'video', title: 'x' }] }, {}, meta);
    expect(unknown.status).toBe('error');
  });

  it('recordDenied leaves an audit entry', async () => {
    await recordDenied('delete_file', { path: '~/Desktop/x' }, { missionId: 'm3' }, 'denied', true);
    const [entry] = await listAudit({ missionId: 'm3' });
    expect(entry.status).toBe('denied');
    expect(entry.approvedBy).toBe('user');
    expect(entry.tainted).toBe(true);
    expect(entry.undoable).toBe(false);
  });

  it('blocks app names that could act on many processes or paths', async () => {
    const res = await executeTool('quit_app', { name: '*' }, {}, meta);
    expect(res.status).toBe('error');
    expect(res.content).toMatch(/앱 이름/);
    const pathy = await executeTool('open_app', { name: 'C:\\evil.exe' }, {}, meta);
    expect(pathy.status).toBe('error');
  });
});

describe('isPlausibleCity', () => {
  it.each(['Seoul', '서울', 'New York', "Xi'an", 'Saint-Étienne', 'St. Louis'])('accepts %s', (city) => {
    expect(isPlausibleCity(city)).toBe(true);
  });

  it.each([
    '',
    'sk-ant-api03-abcdef',
    'password=hunter2',
    'a b c d e f g',
    'x'.repeat(60),
    '../../etc',
    'city?x=1',
    '123 Main',
  ])('rejects %s', (city) => {
    expect(isPlausibleCity(city)).toBe(false);
  });
});
