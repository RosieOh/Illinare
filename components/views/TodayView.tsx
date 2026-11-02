'use client';

import { useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, useToast } from '@/components/glass';
import { longDate, fromIso } from '@/components/planner/dates';
import { EventSheet } from '@/components/planner/EventSheet';
import { minuteToIso, useMinute } from '@/components/planner/hooks';
import { usePlannerActions, usePlannerState, usePlannerSync } from '@/components/planner/store';
import { useRegisterCommands, type Command } from '@/components/shell/commands';
import { ViewScroll, type ViewProps } from '@/components/shell/ViewFrame';
import { AgendaCard } from '@/components/today/AgendaCard';
import { FocusPill } from '@/components/today/FocusPill';
import { ActiveMissionsCard, RecentMissions, useRecentMissions } from '@/components/today/MissionsCard';
import { RoutinesRow } from '@/components/today/RoutinesRow';
import { Starters } from '@/components/today/Starters';
import TeamDroplets from '@/components/mission/TeamDroplets';
import { SystemStrip } from '@/components/today/SystemStrip';
import { TodayTasksCard } from '@/components/today/TodayTasksCard';
import { WeatherCard } from '@/components/today/WeatherCard';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';

function greeting(hour: number): string {
  if (hour < 5) return '늦은 밤이에요';
  if (hour < 11) return '좋은 아침이에요';
  if (hour < 14) return '좋은 점심이에요';
  if (hour < 18) return '좋은 오후예요';
  if (hour < 22) return '좋은 저녁이에요';
  return '늦은 밤이에요';
}

/** 오늘 브리핑 미션의 요청문. 날짜를 넣어야 지휘자가 "오늘"을 정확히 다룬다. */
function briefingGoal(today: string, city: string): string {
  const year = fromIso(today).getFullYear();
  return `오늘은 ${year}년 ${longDate(today)}이에요. 오늘 브리핑을 부탁해요. 내 일정과 할 일을 확인하고 ${city} 날씨를 곁들여서, 오늘 가장 먼저 처리할 일 세 가지와 놓치면 안 되는 마감을 짧게 정리해 주세요. 아무것도 바꾸지 말고 확인만 해 주세요.`;
}

export default function TodayView({ active }: ViewProps) {
  const { settings, navigate } = useApp();
  const { start, summaries } = useMissions();
  const toast = useToast();
  const actions = usePlannerActions();
  const planner = usePlannerState();
  usePlannerSync(active);

  const minute = useMinute(active);
  const today = minuteToIso(minute);
  const [busyGoal, setBusyGoal] = useState<string | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);

  const openPlanner = useCallback(() => navigate('planner'), [navigate]);

  const run = useCallback(
    async (goal: string) => {
      setBusyGoal(goal);
      try {
        await start(goal);
        navigate('missions');
      } catch (err) {
        toast({
          tone: 'danger',
          title: '미션을 시작하지 못했어요',
          description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
        });
      } finally {
        setBusyGoal(null);
      }
    },
    [start, navigate, toast]
  );

  const briefGoal = today ? briefingGoal(today, settings.weatherCity) : '';
  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'today-briefing',
        title: '오늘 브리핑 받기',
        subtitle: '일정, 할 일, 날씨를 모아 짧게 정리해요',
        group: '오늘',
        icon: Sparkles,
        keywords: ['브리핑', '요약', 'briefing'],
        run: () => void run(briefGoal),
      },
    ],
    [run, briefGoal]
  );
  useRegisterCommands(commands);

  const recent = useRecentMissions();
  const hello = minute ? greeting(new Date(minute * 60_000).getHours()) : '안녕하세요';
  const isFirstDay =
    planner.status === 'ready' && planner.tasks.length === 0 && planner.events.length === 0 && summaries.length === 0;

  return (
    <ViewScroll className="@container">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-5 gap-y-3 max-sm:mb-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(2rem,1.45rem+2vw,2.875rem)] leading-[1.12] font-bold tracking-[-0.03em] text-label break-keep">
            {hello}
            {settings.displayName ? `, ${settings.displayName}님` : ''}
          </h1>
          <p className="mt-1.5 text-body text-label-2">{today ? longDate(today) : ' '}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="max-md:hidden">
            <TeamDroplets size={160} active={active} />
          </div>
          <FocusPill active={active} onOpen={openPlanner} />
          <Button icon={Sparkles} variant="secondary" loading={busyGoal === briefGoal && !!briefGoal} disabled={!today} onClick={() => void run(briefGoal)}>
            오늘 브리핑 받기
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3.5 @3xl:grid-cols-12">
        <ActiveMissionsCard className="@3xl:col-span-12" />

        <div className="flex min-w-0 flex-col gap-3.5 @3xl:col-span-7">
          {isFirstDay ? (
            <Starters />
          ) : (
            <AgendaCard planner={planner} minute={minute} today={today} onAddEvent={() => setAddingEvent(true)} onOpenPlanner={openPlanner} />
          )}
          {/* 일정이 있는 날에는 큰 카드의 빈 공간을 채우고, 첫날에는 시작 제안이 충분히 크므로 오른쪽에 둔다. */}
          {!isFirstDay && <WeatherCard city={settings.weatherCity} active={active} />}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 @3xl:col-span-5">
          {isFirstDay && <WeatherCard city={settings.weatherCity} active={active} />}
          <TodayTasksCard planner={planner} today={today} onOpenPlanner={openPlanner} />
        </div>

        <div className="@3xl:col-span-12">
          <SystemStrip active={active} onOpen={() => navigate('system')} />
        </div>

        <RecentMissions recent={recent} now={minute * 60_000} className="material-thin rounded-[16px] p-2.5 @3xl:col-span-7" />

        <RoutinesRow
          active={active}
          onRun={(goal) => void run(goal)}
          busyGoal={busyGoal}
          className={recent.length > 0 ? '@3xl:col-span-5' : '@3xl:col-span-12'}
        />
      </div>

      <EventSheet
        active={active}
        open={addingEvent}
        event={null}
        defaultDate={today}
        onClose={() => setAddingEvent(false)}
        onSave={(input) => void actions.addEvent(input)}
      />
    </ViewScroll>
  );
}
