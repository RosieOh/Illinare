import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { run, ok } from './exec';
import { register } from './registry';
import { safePath, HOME_DIR } from './paths';

const READ_LIMIT = 200 * 1024; // 200KB

// ─── 파일 시스템 ───────────────────────────────────────────
register<{ path: string }>({
  name: 'list_files',
  description: '디렉터리의 파일 목록을 나열합니다. 사용자 홈 안만 허용.',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '예: ~/Desktop, ~/Documents' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  summarize: ({ path }) => `디렉터리 조회: ${path}`,
  async run({ path }) {
    const abs = safePath(path);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      .slice(0, 100);
    return `${abs} (${items.length}개):\n${items.join('\n')}`;
  },
});

register<{ path: string }>({
  name: 'read_file',
  description: '텍스트 파일을 읽습니다. 200KB 초과 시 잘립니다.',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  summarize: ({ path }) => `파일 읽기: ${path}`,
  async run({ path }) {
    const abs = safePath(path);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error('파일이 아닙니다');
    const buf = await fs.readFile(abs);
    const text = buf.subarray(0, READ_LIMIT).toString('utf8');
    const truncated = buf.length > READ_LIMIT ? '\n…(잘림)' : '';
    return `${abs} (${stat.size}바이트):\n${text}${truncated}`;
  },
});

register<{ path: string; content: string }>({
  name: 'write_file',
  description: '파일을 새로 만들거나 덮어씁니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  summarize: ({ path, content }) =>
    `파일 쓰기: ${path} (${content.length}자)`,
  async run({ path, content }) {
    const abs = safePath(path);
    await fs.writeFile(abs, content, 'utf8');
    return ok(`${abs}에 ${content.length}자 저장`);
  },
});

register<{ path: string; content: string }>({
  name: 'append_file',
  description: '파일 끝에 내용을 추가합니다. 파일이 없으면 새로 만듭니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  summarize: ({ path, content }) =>
    `파일에 추가: ${path} (+${content.length}자)`,
  async run({ path, content }) {
    const abs = safePath(path);
    await fs.appendFile(abs, content, 'utf8');
    return ok(`${abs}에 ${content.length}자 추가`);
  },
});

register<{ path: string }>({
  name: 'delete_file',
  description: '파일을 휴지통으로 이동합니다 (영구 삭제 X).',
  risk: 'danger',
  schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  summarize: ({ path }) => `파일 삭제(휴지통): ${path}`,
  async run({ path }) {
    const abs = safePath(path);
    // 영구 삭제 대신 휴지통 이동 — osascript로 처리
    await run('/usr/bin/osascript', [
      '-e',
      `tell application "Finder" to delete POSIX file "${abs.replace(/"/g, '\\"')}"`,
    ]);
    return ok(`${abs}을(를) 휴지통으로 이동했습니다`);
  },
});

register<{ name: string; content: string }>({
  name: 'save_note',
  description: '~/Desktop/illionaire-notes/ 아래에 메모를 저장합니다. 파일명만 지정하면 됩니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '확장자 없는 파일명 (예: meeting-2024)' },
      content: { type: 'string' },
    },
    required: ['name', 'content'],
    additionalProperties: false,
  },
  summarize: ({ name, content }) =>
    `메모 저장: ${name}.md (${content.length}자)`,
  async run({ name, content }) {
    const dir = join(HOME_DIR, 'Desktop', 'illionaire-notes');
    await fs.mkdir(dir, { recursive: true });
    const file = join(dir, `${name.replace(/[^\w\-가-힣\s]/g, '_')}.md`);
    await fs.writeFile(file, content, 'utf8');
    return ok(`메모 저장: ${file}`);
  },
});

// ─── 클립보드 ──────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_clipboard',
  description: '현재 클립보드 텍스트 내용을 읽습니다.',
  risk: 'safe',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '클립보드 읽기',
  async run() {
    const { stdout } = await run('/usr/bin/pbpaste', []);
    const truncated = stdout.length > 4000 ? stdout.slice(0, 4000) + '\n…(잘림)' : stdout;
    return `클립보드 (${stdout.length}자):\n${truncated}`;
  },
});

register<{ text: string }>({
  name: 'set_clipboard',
  description: '클립보드에 텍스트를 복사합니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  summarize: ({ text }) =>
    `클립보드에 복사 (${text.length}자): "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
  async run({ text }) {
    const proc = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const child = proc.spawn('/usr/bin/pbcopy');
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`))
      );
      child.stdin.end(text);
    });
    return ok(`클립보드에 ${text.length}자 복사`);
  },
});
