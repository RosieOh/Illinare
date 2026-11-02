import type { Routine } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, newId, readJson, updateJson } from './json';

interface RoutinesFile {
  routines: Routine[];
  /** 기본 루틴을 넣은 적이 있는가. 사용자가 지운 뒤 다시 생기지 않도록 기억한다. */
  seeded: boolean;
}

const file = () => dataPath('routines.json');

function defaults(): Routine[] {
  const now = Date.now();
  return [
    {
      id: newId('rtn'),
      title: '오늘의 브리핑',
      goal: '오늘 일정과 할 일, 날씨를 확인해서 오늘 무엇에 집중하면 좋을지 짧게 브리핑해 주세요.',
      icon: 'Sunrise',
      createdAt: now,
    },
    {
      id: newId('rtn'),
      title: '다운로드 폴더 정리안',
      goal: '다운로드 폴더를 살펴보고 정리 방안을 제안해 주세요. 파일은 아직 옮기거나 지우지 마세요.',
      icon: 'FolderSearch',
      createdAt: now,
    },
    {
      id: newId('rtn'),
      title: '컴퓨터 상태 점검',
      goal: '시스템 자원과 CPU, 메모리를 많이 쓰는 프로세스를 확인하고 느려질 만한 원인이 있으면 알려 주세요.',
      icon: 'Gauge',
      createdAt: now,
    },
  ];
}

async function load(): Promise<RoutinesFile> {
  const saved = await readJson<RoutinesFile | null>(file(), null);
  if (saved) return saved;
  return updateJson<RoutinesFile>(file(), { routines: [], seeded: false }, (current) =>
    current.seeded ? current : { routines: [...defaults(), ...current.routines], seeded: true }
  );
}

export async function listRoutines(): Promise<Routine[]> {
  return (await load()).routines;
}

export async function addRoutine(input: { title: unknown; goal: unknown; icon?: unknown }): Promise<Routine> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!title || title.length > 60) throw new ApiError(400, 'invalid_routine', '루틴 이름은 1~60자여야 해요.');
  if (!goal || goal.length > 4000) throw new ApiError(400, 'invalid_routine', '루틴 내용은 1~4000자여야 해요.');
  const routine: Routine = {
    id: newId('rtn'),
    title,
    goal,
    icon: typeof input.icon === 'string' && input.icon ? input.icon : 'Sparkles',
    createdAt: Date.now(),
  };
  await load();
  await updateJson<RoutinesFile>(file(), { routines: [], seeded: true }, (current) => ({
    ...current,
    routines: [...current.routines, routine],
  }));
  return routine;
}

export async function removeRoutine(id: string): Promise<void> {
  await load();
  let found = false;
  await updateJson<RoutinesFile>(file(), { routines: [], seeded: true }, (current) => {
    found = current.routines.some((r) => r.id === id);
    return { ...current, routines: current.routines.filter((r) => r.id !== id) };
  });
  if (!found) throw new ApiError(404, 'not_found', '루틴을 찾을 수 없어요.');
}

export async function touchRoutine(id: string): Promise<void> {
  await updateJson<RoutinesFile>(file(), { routines: [], seeded: true }, (current) => ({
    ...current,
    routines: current.routines.map((r) => (r.id === id ? { ...r, lastRunAt: Date.now() } : r)),
  }));
}
