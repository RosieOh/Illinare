'use client';

import { useEffect, useState } from 'react';
import {
  CalendarCheck,
  FileText,
  FolderSearch,
  Gauge,
  Globe,
  ListChecks,
  Mail,
  Newspaper,
  PenLine,
  Repeat,
  Search,
  Sparkles,
  Sunrise,
  type LucideIcon,
} from 'lucide-react';
import type { Routine } from '@/lib/contracts';
import { api } from '@/lib/client/api';
import { Button } from '@/components/glass';
import { useApp } from '@/context/AppContext';

const ICONS: Record<string, LucideIcon> = {
  CalendarCheck,
  FileText,
  FolderSearch,
  Gauge,
  Globe,
  ListChecks,
  Mail,
  Newspaper,
  PenLine,
  Search,
  Sparkles,
  Sunrise,
};

/** 자주 맡기는 일을 한 번에. 눌러서 바로 미션을 시작한다. */
export function RoutinesRow({ active, onRun, busyGoal, className }: {
  active: boolean;
  onRun: (goal: string) => void;
  busyGoal: string | null;
  className?: string;
}) {
  const { navigate } = useApp();
  const [routines, setRoutines] = useState<Routine[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    api
      .get<{ routines: Routine[] }>('/api/routines')
      .then((data) => {
        if (alive) setRoutines(data.routines);
      })
      .catch(() => {
        // 루틴은 부가 기능이다. 읽지 못하면 줄을 숨긴다.
        if (alive) setRoutines([]);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  if (!routines) return null;

  return (
    <section aria-labelledby="today-routines" className={`material-thin rounded-[16px] p-2.5 ${className ?? ''}`}>
      <div className="mb-1 flex items-center justify-between gap-2 pl-2">
        <h2 id="today-routines" className="flex items-center gap-1.5 text-subhead font-semibold text-label-2">
          <Repeat size={13} aria-hidden="true" />
          루틴
        </h2>
        <Button size="sm" variant="plain" className="!h-7 !px-2" onClick={() => navigate('settings')}>
          관리
        </Button>
      </div>
      {routines.length === 0 ? (
        <p className="px-2 pb-1.5 text-subhead text-label-2">자주 맡기는 일을 저장해 두면 여기서 바로 시작할 수 있어요.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {routines.map((routine) => {
            const Icon = ICONS[routine.icon] ?? Repeat;
            return (
              <Button key={routine.id} size="sm" icon={Icon} loading={busyGoal === routine.goal} onClick={() => onRun(routine.goal)}>
                {routine.title}
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}
