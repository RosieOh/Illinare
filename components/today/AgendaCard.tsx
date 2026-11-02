'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronDown, CircleAlert, RotateCcw } from 'lucide-react';
import type { CalendarEvent } from '@/lib/contracts';
import { Button, EmptyState, Material, Skeleton } from '@/components/glass';
import { dueLabel } from '@/components/planner/dates';
import { KIND_META, KindDot } from '@/components/planner/EventsPane';
import { minuteOfDay } from '@/components/planner/hooks';
import { buildAgenda, durationLabel, eventRange, nowMarkerIndex, sortEvents, untilLabel, type AgendaItem } from '@/components/planner/logic';
import { refreshPlanner, type PlannerState } from '@/components/planner/store';
import { formatClock } from '@/lib/client/format';

const MAX_ROWS = 6;

function endClock(event: CalendarEvent): string | null {
  const range = eventRange(event);
  if (!range) return null;
  const end = Math.min(range.end, 24 * 60 - 1);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

/** 가장 크게 보여줄 한 건: 진행 중이면 그 일정, 아니면 다음 일정 */
function Lead({ items, nowMinutes, upcoming, today }: {
  items: AgendaItem[];
  nowMinutes: number;
  upcoming: CalendarEvent | null;
  today: string;
}) {
  const current = items.find((i) => i.phase === 'now');
  const next = items.find((i) => i.phase === 'next');
  const lead = current ?? next;

  if (lead) {
    const { event } = lead;
    const range = eventRange(event);
    const isNow = lead.phase === 'now';
    return (
      <div>
        <p className="text-title1 max-sm:text-title2 text-label break-keep [overflow-wrap:anywhere]">{event.title}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-callout text-label-2">
          {isNow ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-accent-text">
              <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              진행 중
            </span>
          ) : (
            <span className="font-semibold text-accent-text">{untilLabel((range?.start ?? 0) - nowMinutes)}</span>
          )}
          <span className="tabular-nums">
            {event.time}
            {isNow && ` ~ ${endClock(event)}`}
          </span>
          {!isNow && event.durationMin !== undefined && <span>{durationLabel(event.durationMin)}</span>}
          <span className="inline-flex items-center gap-1.5">
            <KindDot kind={event.kind} />
            {KIND_META[event.kind].label}
          </span>
        </p>
      </div>
    );
  }

  const hadToday = items.length > 0;
  return (
    <div>
      <p className="text-title2 text-label">{hadToday ? '오늘 남은 일정이 없어요' : '오늘은 일정이 비어 있어요'}</p>
      {upcoming ? (
        <p className="mt-1.5 text-callout text-label-2 break-keep">
          다음은 {dueLabel(upcoming.date, today).text}
          {upcoming.time && <span className="tabular-nums"> {upcoming.time}</span>}, {upcoming.title}
        </p>
      ) : (
        <p className="mt-1.5 text-callout text-label-2">남은 시간을 온전히 쓸 수 있어요.</p>
      )}
    </div>
  );
}

function Row({ item, emphasized }: { item: AgendaItem; emphasized: boolean }) {
  const { event, phase } = item;
  const faded = phase === 'past';
  return (
    <li className="grid grid-cols-[46px_14px_minmax(0,1fr)] items-start gap-x-2.5 py-1.5">
      <span className={`pt-px text-subhead tabular-nums ${emphasized ? 'font-semibold text-label' : 'text-label-2'}`}>{event.time ?? '종일'}</span>
      <span className="flex justify-center pt-[7px]" aria-hidden="true">
        <span
          className={`relative z-[1] size-2 rounded-full ${faded ? 'opacity-45' : ''}`}
          style={{ background: KIND_META[event.kind].color }}
        />
      </span>
      <span className="flex min-w-0 items-start gap-3">
        <span className={`min-w-0 flex-1 text-callout break-keep [overflow-wrap:anywhere] ${faded ? 'text-label-2' : emphasized ? 'font-semibold text-label' : 'text-label'} ${event.done ? 'line-through decoration-label-3' : ''}`}>
          {event.title}
        </span>
        {event.durationMin !== undefined && event.time && !faded && (
          <span className="shrink-0 pt-px text-footnote text-label-2">{durationLabel(event.durationMin)}</span>
        )}
      </span>
    </li>
  );
}

function NowMarker({ minute }: { minute: number }) {
  return (
    <li aria-label={`지금 ${formatClock(minute * 60_000)}`} className="grid grid-cols-[46px_14px_minmax(0,1fr)] items-center gap-x-2.5 py-0.5">
      <span className="text-footnote font-semibold text-accent-text tabular-nums">{formatClock(minute * 60_000)}</span>
      <span className="flex justify-center" aria-hidden="true">
        <span className="relative z-[1] size-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_var(--accent-tint)]" />
      </span>
      <span className="h-px bg-[var(--accent)] opacity-70" aria-hidden="true" />
    </li>
  );
}

export function AgendaCard({ planner, minute, today, onAddEvent, onOpenPlanner }: {
  planner: PlannerState;
  minute: number;
  today: string;
  onAddEvent: () => void;
  onOpenPlanner: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nowMinutes = minuteOfDay(minute);
  const { events, status } = planner;

  const items = useMemo(() => buildAgenda(events.filter((e) => e.date === today), nowMinutes), [events, today, nowMinutes]);
  const upcoming = useMemo(() => sortEvents(events.filter((e) => e.date > today))[0] ?? null, [events, today]);

  // 지난 일정은 가까운 하나만 남기고 접는다. 긴 하루도 첫 화면이 앞으로의 일을 보여주도록.
  const markerAt = nowMarkerIndex(items, nowMinutes);
  const allDay = items.filter((i) => i.phase === 'allDay');
  const timed = items.slice(allDay.length);
  const pastCount = Math.max(0, markerAt - allDay.length);
  const hiddenPast = expanded ? 0 : Math.max(0, pastCount - 1);
  const shownTimed = timed.slice(hiddenPast);
  const markerInShown = pastCount - hiddenPast;
  const room = expanded ? Infinity : Math.max(1, MAX_ROWS - allDay.length);
  const visibleTimed = shownTimed.slice(0, room);
  const hiddenLater = shownTimed.length - visibleTimed.length;
  const hiddenTotal = hiddenPast + hiddenLater;
  const leadId = items.find((i) => i.phase === 'now')?.event.id ?? items.find((i) => i.phase === 'next')?.event.id;

  return (
    <Material as="section" aria-labelledby="today-agenda" className="flex flex-1 flex-col p-5 max-sm:p-4">
      {/* 눈에 보이는 제목은 아래의 일정 이름이다. 보조기기에는 카드의 역할을 알려 준다. */}
      <h2 id="today-agenda" className="sr-only">
        {items.some((i) => i.phase === 'now') ? '지금 일정' : items.some((i) => i.phase === 'next') ? '다음 일정' : '오늘 일정'}
      </h2>

      {status === 'loading' && events.length === 0 ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton width="60%" height={30} radius={8} className="block" />
          <Skeleton width="35%" className="block" />
          <Skeleton width="100%" height={1} className="mt-5 block" />
          <Skeleton width="75%" className="block" />
          <Skeleton width="65%" className="block" />
        </div>
      ) : status === 'error' ? (
        <EmptyState
          compact
          icon={CircleAlert}
          title="일정을 불러오지 못했어요"
          description={planner.error}
          action={
            <Button size="sm" icon={RotateCcw} onClick={() => void refreshPlanner()}>
              다시 시도
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Lead items={items} nowMinutes={nowMinutes} upcoming={upcoming} today={today} />
            </div>
            <Button size="sm" variant="plain" icon={CalendarPlus} className="-mr-3 shrink-0" onClick={onAddEvent}>
              일정 추가
            </Button>
          </div>

          {items.some((i) => i.event.id !== leadId) && (
            <>
              <div className="my-4 h-px bg-[var(--separator)]" aria-hidden="true" />
              <div className="relative">
                {/* 시간 흐름을 잇는 세로선 */}
                <span className="absolute top-3 bottom-3 left-[62px] w-px bg-[var(--separator)]" aria-hidden="true" />
                <ol className="relative" aria-label="오늘 일정">
                  {allDay.map((item) => (
                    <Row key={item.event.id} item={item} emphasized={false} />
                  ))}
                  {visibleTimed.flatMap((item, i) => [
                    ...(i === markerInShown ? [<NowMarker key="now" minute={minute} />] : []),
                    ...(item.event.id === leadId ? [] : [<Row key={item.event.id} item={item} emphasized={false} />]),
                  ])}
                  {markerInShown >= visibleTimed.length && hiddenLater === 0 && <NowMarker key="now-end" minute={minute} />}
                </ol>
              </div>
            </>
          )}

          <div className="-mx-3 mt-auto flex flex-wrap items-center justify-between gap-1 pt-2">
            {hiddenTotal > 0 ? (
              <Button size="sm" variant="plain" iconRight={ChevronDown} onClick={() => setExpanded(true)}>
                {hiddenLater === 0 ? `지난 일정 ${hiddenTotal}개 더 보기` : hiddenPast > 0 ? `지난 일정 포함 ${hiddenTotal}개 더 보기` : `${hiddenTotal}개 더 보기`}
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" variant="plain" onClick={onOpenPlanner}>
              플래너에서 보기
            </Button>
          </div>
        </>
      )}
    </Material>
  );
}
