import { promises as fs } from 'node:fs';
import type { AuditEntry } from '@/lib/contracts';
import { appendLine, dataDir, dataPath, newId } from './json';

/**
 * 감사 기록. 추가만 하는 JSONL 파일이다.
 * 되돌리기도 기존 줄을 고치지 않고 undo 레코드를 덧붙인다.
 * 파일이 커지면 보관 파일로 넘기고 지우지 않는다. 모든 행동이 기록에 남는다는 것이 제품의 약속이다.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const file = () => dataPath('audit.jsonl');
const ARCHIVE = /^audit\.(\d+)\.jsonl$/;

/** 저장 전용 필드까지 포함한 레코드. journalId는 화면으로 나가지 않는다. */
export type StoredAuditEntry = AuditEntry & { journalId?: string };

type UndoRecord = { undo: string; at: number };

async function rotateIfLarge() {
  try {
    const stat = await fs.stat(file());
    if (stat.size > MAX_FILE_BYTES) await fs.rename(file(), dataPath(`audit.${Date.now()}.jsonl`));
  } catch {
    /* 파일이 아직 없거나 회전에 실패해도 기록은 계속한다 */
  }
}

/** 최신 파일부터. */
async function auditFiles(): Promise<string[]> {
  const names = await fs.readdir(dataDir()).catch(() => [] as string[]);
  const archives = names
    .flatMap((name) => {
      const match = ARCHIVE.exec(name);
      return match ? [{ name, order: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.order - a.order)
    .map(({ name }) => dataPath(name));
  return [file(), ...archives];
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

/**
 * 시간순으로 돌려준다. 최신 파일부터 읽다가 enough가 참이면 멈춘다. 보관 파일이 쌓여도 필요한 만큼만 읽기 위해서다.
 * undo 레코드는 항상 원래 기록보다 새 파일에 있으므로 일찍 멈춰도 빠지지 않는다.
 */
async function readAll(enough: (entries: StoredAuditEntry[]) => boolean = () => false): Promise<StoredAuditEntry[]> {
  let entries: StoredAuditEntry[] = [];
  const undone = new Map<string, number>();
  for (const path of await auditFiles()) {
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    const batch: StoredAuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as StoredAuditEntry | UndoRecord;
        if ('undo' in parsed) undone.set(parsed.undo, parsed.at);
        else batch.push(parsed);
      } catch {
        /* 쓰다 끊긴 줄은 건너뛴다 */
      }
    }
    entries = batch.concat(entries);
    if (enough(entries)) break;
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
  const limit = opts.limit ?? 200;
  const matches = (e: StoredAuditEntry) => !opts.missionId || e.missionId === opts.missionId;
  const entries = await readAll((seen) => seen.filter(matches).length >= limit);
  return entries.filter(matches).reverse().slice(0, limit).map(toPublic);
}

export async function getStoredAudit(id: string): Promise<StoredAuditEntry | undefined> {
  return (await readAll((seen) => seen.some((e) => e.id === id))).find((e) => e.id === id);
}

export async function markUndone(id: string): Promise<void> {
  const record: UndoRecord = { undo: id, at: Date.now() };
  await appendLine(file(), JSON.stringify(record));
}
