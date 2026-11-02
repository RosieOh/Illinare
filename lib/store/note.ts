import type { Note } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, readJson, writeJson } from './json';

const file = () => dataPath('note.json');
export const MAX_NOTE = 200_000;

export function getNote(): Promise<Note> {
  return readJson<Note>(file(), { body: '', updatedAt: 0 });
}

export async function setNote(body: unknown): Promise<Note> {
  if (typeof body !== 'string' || body.length > MAX_NOTE) {
    throw new ApiError(400, 'invalid_note', '메모는 20만 자까지 저장할 수 있어요.');
  }
  const note: Note = { body, updatedAt: Date.now() };
  await writeJson(file(), note);
  return note;
}
