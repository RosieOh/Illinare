'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ListChecks, Pause, Play, Timer } from 'lucide-react';
import { Segmented, useToast, type SegmentedOption } from '@/components/glass';
import { EventsPane } from '@/components/planner/EventsPane';
import { FocusPane } from '@/components/planner/FocusPane';
import { minuteToIso, useMinute } from '@/components/planner/hooks';
import { NotePane } from '@/components/planner/NotePane';
import { usePlannerState, usePlannerSync } from '@/components/planner/store';
import { TasksPane } from '@/components/planner/TasksPane';
import { useRegisterCommands, type Command } from '@/components/shell/commands';
import { ViewFixed, ViewHeader, type ViewProps } from '@/components/shell/ViewFrame';
import { useFocusTimer } from '@/context/FocusContext';

type Area = 'tasks' | 'events' | 'focus';

const AREAS: SegmentedOption<Area>[] = [
  { value: 'tasks', label: '할 일', icon: ListChecks },
  { value: 'events', label: '일정', icon: CalendarDays },
  { value: 'focus', label: '집중', icon: Timer },
];

/** 넓은 화면에서는 세 작업 영역을 한눈에, 좁으면 하나씩. 모두 마운트한 채 CSS로 숨겨 입력 중인 내용이 남는다. */
export default function PlannerView({ active }: ViewProps) {
  usePlannerSync(active);
  const planner = usePlannerState();
  const minute = useMinute(active);
  const today = minuteToIso(minute);
  const [area, setArea] = useState<Area>('tasks');
  const focus = useFocusTimer();
  const toast = useToast();

  const running = focus.state.status === 'running';
  const { start, pause } = focus;
  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'focus-toggle',
        title: running ? '집중 타이머 일시정지' : '집중 타이머 시작',
        group: '플래너',
        icon: running ? Pause : Play,
        keywords: ['포모도로', 'pomodoro', '타이머'],
        run: () => {
          if (running) pause();
          else {
            start();
            toast({ title: '집중 타이머를 시작했어요' });
          }
        },
      },
    ],
    [running, start, pause, toast]
  );
  useRegisterCommands(commands);

  const panel = (id: Area) => (area === id ? '' : 'max-[1119px]:hidden');

  return (
    <ViewFixed>
      <ViewHeader title="플래너" subtitle="할 일, 일정, 집중, 메모를 한곳에서 봐요." />
      <div className="mb-3 shrink-0 min-[1120px]:hidden">
        <Segmented options={AREAS} value={area} onChange={setArea} label="플래너 영역" fullWidth />
      </div>
      <div className="mx-auto grid min-h-0 w-full max-w-[1560px] flex-1 grid-cols-1 gap-3.5 min-[1120px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(300px,0.85fr)]">
        <div className={`min-h-0 ${panel('tasks')}`}>
          <TasksPane planner={planner} today={today} />
        </div>
        <div className={`min-h-0 ${panel('events')}`}>
          <EventsPane planner={planner} today={today} active={active} />
        </div>
        <div className={`flex min-h-0 flex-col gap-3.5 overflow-y-auto ${panel('focus')}`}>
          <FocusPane active={active} today={today} />
          <NotePane active={active} />
        </div>
      </div>
    </ViewFixed>
  );
}
