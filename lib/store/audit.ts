import { promises as fs } from 'node:fs';
import type { AuditEntry } from '@/lib/contracts';
import { appendLine, dataPath, newId } from './json';

/**
 * 감사 기록. 추가만 하는 JSONL 파일이다.
 * 되돌리기도 기존 줄을 고치지 않고 undo 레코드를 덧붙인다.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const file = () => dataPath('audit.jsonl');

/** 저장 전용 필드까지 포함한 레코드. journalId는 화면으로 나가지 않는다. */
export type StoredAuditEntry = AuditEntry & { journalId?: string };

type UndoRecord = { undo: string; at: number };

async function rotateIfLarge() {
  try {
    const stat = await fs.stat(file());
    if (stat.size > MAX_FILE_BYTES) await fs.rename(file(), dataPath('audit.1.jsonl'));
  } catch {
    /* 파일이 아직 없거나 회전에 실패해도 기록은 계속한다 */
  }
}

export async function appendAudit(
  entry: Omit<AuditEntry, 'id' | 'at' | 'undoable'> & { journalId?: string; undoable?: boolean }
): Promise<StoredAuditEntry> {
  await rotateIfLarge();
  const stored: StoredAuditEntry = {
    ...entry,
    id: newId('aud'),
    at: Date.now(),
    undoable: Boolean(entry.journalId),
  };
  await appendLine(file(), JSON.stringify(stored));
  return stored;
}

async function readAll(): Promise<StoredAuditEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const entries: StoredAuditEntry[] = [];
  const undone = new Map<string, number>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as StoredAuditEntry | UndoRecord;
      if ('undo' in parsed) undone.set(parsed.undo, parsed.at);
      else entries.push(parsed);
    } catch {
      /* 쓰다 끊긴 줄은 건너뛴다 */
    }
  }
  return entries.map((e) => {
    const undoneAt = undone.get(e.id);
    return undoneAt ? { ...e, undoneAt, undoable: false } : e;
  });
}

function toPublic(entry: StoredAuditEntry): AuditEntry {
  const copy = { ...entry };
  delete copy.journalId;
  return copy;
}

/** 최신순. */
export async function listAudit(opts: { limit?: number; missionId?: string | null } = {}): Promise<AuditEntry[]> {
  const entries = await readAll();
  const filtered = opts.missionId ? entries.filter((e) => e.missionId === opts.missionId) : entries;
  return filtered
    .reverse()
    .slice(0, opts.limit ?? 200)
    .map(toPublic);
}

export async function getStoredAudit(id: string): Promise<StoredAuditEntry | undefined> {
  return (await readAll()).find((e) => e.id === id);
}

export async function markUndone(id: string): Promise<void> {
  const record: UndoRecord = { undo: id, at: Date.now() };
  await appendLine(file(), JSON.stringify(record));
}
