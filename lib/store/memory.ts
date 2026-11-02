import type { MemoryItem } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, newId, readJson, updateJson } from './json';

const file = () => dataPath('memory.json');
const MAX_ITEMS = 200;

export function listMemory(): Promise<MemoryItem[]> {
  return readJson<MemoryItem[]>(file(), []);
}

/**
 * 에이전트가 저장한 기억은 외부 내용의 영향을 받았을 수 있다.
 * 미션 프롬프트에 넣을 때는 사용자 지시가 아니라 데이터로 다루고, 호출한 쪽을 오염 상태로 친다.
 */
export function hasUntrustedMemory(items: MemoryItem[]): boolean {
  return items.some((item) => item.source === 'agent');
}

export async function addMemory(text: unknown, source: MemoryItem['source']): Promise<MemoryItem> {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > 500) {
    throw new ApiError(400, 'invalid_memory', '기억할 내용은 1~500자여야 해요.');
  }
  const item: MemoryItem = { id: newId('mem'), text: trimmed, source, createdAt: Date.now() };
  await updateJson<MemoryItem[]>(file(), [], (items) => {
    if (items.length >= MAX_ITEMS) {
      throw new ApiError(400, 'memory_full', `기억은 ${MAX_ITEMS}개까지 저장할 수 있어요. 설정에서 일부를 지워 주세요.`);
    }
    return [...items, item];
  });
  return item;
}

export async function removeMemory(id: string): Promise<void> {
  let found = false;
  await updateJson<MemoryItem[]>(file(), [], (items) => {
    found = items.some((m) => m.id === id);
    return items.filter((m) => m.id !== id);
  });
  if (!found) throw new ApiError(404, 'not_found', '기억 항목을 찾을 수 없어요.');
}
