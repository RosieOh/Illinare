import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { safeWritePath } from '@/lib/tools/paths';
import { dataPath, newId, readJson, writeJson } from './json';

/**
 * 되돌리기 저널. 파일을 바꾸기 전에 원본을 복사해 두고, 바꾼 뒤의 해시를 기록한다.
 * 되돌릴 때 그 사이 사용자가 파일을 고쳤다면(해시 불일치) 덮어쓰지 않고 거부한다.
 */
const MAX_JOURNAL_BYTES = 50 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface JournalRecord {
  id: string;
  at: number;
  path: string;
  kind: 'write' | 'delete';
  /** 변경 전에 파일이 있었는가 */
  existed: boolean;
  /** 변경 후 파일 해시. 삭제면 null */
  afterHash: string | null;
}

const dir = (id: string) => dataPath('journal', id);
const metaFile = (id: string) => dataPath('journal', id, 'meta.json');
const blobFile = (id: string) => dataPath('journal', id, 'before');

async function hashFile(path: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await fs.readFile(path)).digest('hex');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

let pruned = false;

/** 오래된 저널을 프로세스당 한 번 정리한다. */
async function pruneOnce() {
  if (pruned) return;
  pruned = true;
  const root = dataPath('journal');
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const cutoff = Date.now() - RETENTION_MS;
  await Promise.all(
    entries.map(async (id) => {
      const meta = await readJson<JournalRecord | null>(metaFile(id), null).catch(() => null);
      if (meta && meta.at < cutoff) await fs.rm(dir(id), { recursive: true, force: true }).catch(() => undefined);
    })
  );
}

/**
 * 변경 직전에 호출한다. 원본이 너무 크면 null을 돌려주며 그 변경은 되돌릴 수 없다.
 * 호출자는 변경 후 commitJournal(id)을 불러야 한다.
 */
export async function captureBefore(path: string, kind: JournalRecord['kind']): Promise<string | null> {
  void pruneOnce();
  const id = newId('jnl');
  let existed = false;
  try {
    const stat = await fs.stat(path);
    if (stat.isDirectory() || stat.size > MAX_JOURNAL_BYTES) return null;
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(dir(id), { recursive: true });
  if (existed) await fs.copyFile(path, blobFile(id));
  const record: JournalRecord = { id, at: Date.now(), path, kind, existed, afterHash: null };
  await writeJson(metaFile(id), record);
  return id;
}

/** 변경이 끝난 뒤 호출해 결과 해시를 기록한다. */
export async function commitJournal(id: string): Promise<void> {
  const record = await readJson<JournalRecord | null>(metaFile(id), null);
  if (!record) return;
  await writeJson(metaFile(id), { ...record, afterHash: await hashFile(record.path) });
}

/** 도구가 실패했을 때 복사본을 지운다. */
export async function discardJournal(id: string): Promise<void> {
  await fs.rm(dir(id), { recursive: true, force: true }).catch(() => undefined);
}

export async function restoreJournal(id: string): Promise<{ path: string; message: string }> {
  const record = await readJson<JournalRecord | null>(metaFile(id), null);
  if (!record) throw new Error('되돌리기 정보가 없어요. 보관 기간(30일)이 지났을 수 있어요.');

  // 저널 파일이 조작되었거나 그 사이 경로에 링크가 생겼어도 쓰기 규칙 밖으로 나가지 않는다.
  const target = safeWritePath(record.path);

  const currentHash = await hashFile(target);
  if (record.kind === 'delete') {
    if (currentHash !== null) {
      throw new Error(`같은 경로에 새 파일이 있어 되돌리지 않았어요: ${target}`);
    }
  } else if (currentHash !== record.afterHash) {
    throw new Error(`그 뒤로 파일이 바뀌어 되돌리지 않았어요: ${target}`);
  }

  if (record.existed) {
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.copyFile(blobFile(id), target);
    await discardJournal(id);
    return { path: target, message: `원래 내용으로 되돌렸어요: ${target}` };
  }
  // 이 변경이 새로 만든 파일이었다.
  await fs.rm(target, { force: true });
  await discardJournal(id);
  return { path: target, message: `새로 만든 파일을 지웠어요: ${target}` };
}
