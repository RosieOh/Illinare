import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import { dataPath } from '@/lib/store/json';
import { executeTool } from '@/lib/tools/execute';
import { getTool } from '@/lib/tools';
import { isCommonFolder, isHardLink, isReadable, resetProtectedInodesForTests, safePath, safeWritePath } from '@/lib/tools/paths';
import { gate } from '@/lib/tools/policy';

/** 실제 fs.link로 만든 링크를 쓴다. 이 저장소의 개발 기기에서는 NTFS다. */
describe('hard links', () => {
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const savedHome = process.env[homeKey];
  const meta = { approvedBy: 'user' as const, tainted: false };
  let home: string;
  const docs = (name: string) => path.join(home, 'Documents', name);
  const allowAll = (name: string): Settings => ({ ...DEFAULT_SETTINGS, toolPolicies: { [name]: 'allow' } });

  beforeAll(() => {
    home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'illionaire-links-')));
    mkdirSync(path.join(home, 'Documents'), { recursive: true });
    mkdirSync(path.join(home, '.ssh'), { recursive: true });
    mkdirSync(path.dirname(dataPath('secrets.json')), { recursive: true });
    process.env[homeKey] = home;
  });

  afterAll(() => {
    process.env[homeKey] = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => resetProtectedInodesForTests());

  it('reads the real inode as a bigint, since NTFS ids can exceed 2^53', () => {
    writeFileSync(docs('ino.txt'), 'x');
    linkSync(docs('ino.txt'), docs('ino-link.txt'));
    const a = statSync(docs('ino.txt'), { bigint: true });
    const b = statSync(docs('ino-link.txt'), { bigint: true });
    expect(typeof a.ino).toBe('bigint');
    expect(a.ino).toBe(b.ino);
    expect(a.dev).toBe(b.dev);
    expect(Number(a.nlink)).toBe(2);
  });

  describe('to a blocked file', () => {
    it('refuses a link to an SSH key for both reads and writes', async () => {
      const key = path.join(home, '.ssh', 'id_ed25519');
      writeFileSync(key, 'PRIVATE-KEY-BODY');
      linkSync(key, docs('holiday-photos.txt'));

      expect(() => safePath('~/Documents/holiday-photos.txt')).toThrow(/하드 링크/);
      expect(() => safeWritePath('~/Documents/holiday-photos.txt')).toThrow(/하드 링크/);
      expect(isReadable(docs('holiday-photos.txt'))).toBe(false);
      expect(isCommonFolder('~/Documents/holiday-photos.txt')).toBe(false);

      const read = await executeTool('read_file', { path: '~/Documents/holiday-photos.txt' }, {}, meta);
      expect(read.status).toBe('error');
      expect(read.content).not.toContain('PRIVATE-KEY-BODY');

      const write = await executeTool('write_file', { path: '~/Documents/holiday-photos.txt', content: 'overwritten' }, {}, meta);
      expect(write.status).toBe('error');
      expect(readFileSync(key, 'utf8')).toBe('PRIVATE-KEY-BODY');
    });

    it("refuses a link to this app's own secrets.json", async () => {
      writeFileSync(dataPath('secrets.json'), '{"anthropicApiKey":"sk-ant-linked"}');
      linkSync(dataPath('secrets.json'), docs('notes.txt'));
      resetProtectedInodesForTests();

      expect(() => safePath('~/Documents/notes.txt')).toThrow(/하드 링크/);
      expect(() => safeWritePath('~/Documents/notes.txt')).toThrow(/하드 링크/);
      const read = await executeTool('read_file', { path: '~/Documents/notes.txt' }, {}, meta);
      expect(read.status).toBe('error');
      expect(read.content).not.toContain('sk-ant-linked');
      rmSync(docs('notes.txt'));
      rmSync(dataPath('secrets.json'));
    });

    it('refuses a link to a shell profile, which the write rules only know by path', () => {
      writeFileSync(path.join(home, '.bashrc'), 'export PATH');
      linkSync(path.join(home, '.bashrc'), docs('shell.txt'));
      expect(() => safeWritePath('~/Documents/shell.txt')).toThrow(/하드 링크/);
    });
  });

  describe('to anything else', () => {
    beforeAll(() => {
      writeFileSync(docs('plain.txt'), 'shared body');
      linkSync(docs('plain.txt'), docs('plain-link.txt'));
      writeFileSync(docs('single.txt'), 'one name');
    });

    it('is allowed by the path guard and recognized as a link from either name', () => {
      expect(safePath('~/Documents/plain-link.txt')).toBe(docs('plain-link.txt'));
      expect(isHardLink('~/Documents/plain-link.txt')).toBe(true);
      expect(isHardLink('~/Documents/plain.txt')).toBe(true);
      expect(isHardLink('~/Documents/single.txt')).toBe(false);
      expect(isHardLink('~/Documents/does-not-exist.txt')).toBe(false);
      expect(isHardLink('~/Documents')).toBe(false);
    });

    it.each(['write_file', 'append_file'])('%s asks even under always allow, and the summary says so', (name) => {
      const tool = getTool(name)!;
      const input = { path: '~/Documents/plain-link.txt', content: 'x' };
      expect(gate(tool, { settings: allowAll(name), tainted: false, input })).toMatchObject({ action: 'ask', reason: expect.stringContaining('하드 링크') });
      expect(tool.summarize(input)).toContain('하드 링크');

      const normal = { path: '~/Documents/single.txt', content: 'x' };
      expect(gate(tool, { settings: allowAll(name), tainted: false, input: normal }).action).toBe('run');
      expect(tool.summarize(normal)).not.toContain('하드 링크');
    });

    it('read_file asks too, even in an everyday folder where it normally needs no approval', () => {
      const tool = getTool('read_file')!;
      const input = { path: '~/Documents/plain-link.txt' };
      expect(isCommonFolder(input.path)).toBe(true);
      expect(gate(tool, { settings: DEFAULT_SETTINGS, tainted: false, input }).action).toBe('ask');
      expect(gate(tool, { settings: allowAll('read_file'), tainted: false, input }).action).toBe('ask');
      expect(tool.summarize(input)).toContain('하드 링크');
      expect(gate(tool, { settings: DEFAULT_SETTINGS, tainted: false, input: { path: '~/Documents/single.txt' } }).action).toBe('run');
    });

    it('a block policy still wins over asking', () => {
      const tool = getTool('write_file')!;
      const settings: Settings = { ...DEFAULT_SETTINGS, toolPolicies: { write_file: 'block' } };
      expect(gate(tool, { settings, tainted: false, input: { path: '~/Documents/plain-link.txt', content: 'x' } }).action).toBe('block');
    });

    it('runs once approved, because the check does not block the path itself', async () => {
      const res = await executeTool('read_file', { path: '~/Documents/plain-link.txt' }, {}, meta);
      expect(res.status).toBe('ok');
      expect(res.content).toContain('shared body');
    });

    it('stops treating the file as a link once the other name is gone', () => {
      writeFileSync(docs('pair.txt'), 'x');
      linkSync(docs('pair.txt'), docs('pair-link.txt'));
      expect(isHardLink('~/Documents/pair.txt')).toBe(true);
      rmSync(docs('pair-link.txt'));
      expect(isHardLink('~/Documents/pair.txt')).toBe(false);
    });

    describe('take_screenshot, which builds its own path', () => {
      const shots = () => path.join(home, 'Desktop', 'illionaire-screenshots');

      beforeAll(() => mkdirSync(shots(), { recursive: true }));

      // 거부되는 경우만 실행한다. 통과하면 이 기기의 화면을 실제로 캡처한다.
      it('cannot overwrite a protected file through a link', async () => {
        const key = path.join(home, '.ssh', 'id_rsa');
        writeFileSync(key, 'PRIVATE-KEY-BODY');
        linkSync(key, path.join(shots(), 'evidence.png'));
        const res = await executeTool('take_screenshot', { filename: 'evidence' }, {}, meta);
        expect(res.status).toBe('error');
        expect(res.content).toContain('하드 링크');
        expect(readFileSync(key, 'utf8')).toBe('PRIVATE-KEY-BODY');
      });

      it('asks before writing over any other link, even under always allow', () => {
        linkSync(docs('single.txt'), path.join(shots(), 'plain.png'));
        const tool = getTool('take_screenshot')!;
        expect(gate(tool, { settings: allowAll('take_screenshot'), tainted: false, input: { filename: 'plain' } }).action).toBe('ask');
        expect(tool.summarize({ filename: 'plain' })).toContain('하드 링크');
        expect(gate(tool, { settings: allowAll('take_screenshot'), tainted: false, input: { filename: 'fresh' } }).action).toBe('run');
      });

      it('cannot follow a junction out of the allowed folders', async () => {
        rmSync(shots(), { recursive: true, force: true });
        symlinkSync(path.join(home, '.ssh'), shots(), 'junction');
        const res = await executeTool('take_screenshot', { filename: 'through-junction' }, {}, meta);
        expect(res.status).toBe('error');
        expect(existsSync(path.join(home, '.ssh', 'through-junction.png'))).toBe(false);
        rmSync(shots());
        mkdirSync(shots(), { recursive: true });
      });
    });

    it('sees through a note saved under a linked name', () => {
      const notes = path.join(home, 'Desktop', 'illionaire-notes');
      mkdirSync(notes, { recursive: true });
      writeFileSync(path.join(notes, 'plan.md'), 'x');
      linkSync(path.join(notes, 'plan.md'), docs('plan-copy.txt'));
      const tool = getTool('save_note')!;
      expect(gate(tool, { settings: allowAll('save_note'), tainted: false, input: { name: 'plan', content: 'y' } }).action).toBe('ask');
    });
  });
});
