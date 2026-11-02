'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight, CircleAlert, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import type { CalendarEvent } from '@/lib/contracts';
import { Badge, Button, EmptyState, IconButton, Material, spring } from '@/components/glass';
import { addDays, addMonths, fromIso, longDate, monthLabel, weekdayShort, weekOf } from './dates';
import { EventSheet } from './EventSheet';
import { durationLabel, findOverlaps, sortEvents } from './logic';
import { isTemp, refreshPlanner, rowKey, usePlannerActions, type PlannerState } from './store';
import { CheckCircle } from './TaskRow';

export const KIND_META: Record<CalendarEvent['kind'], { label: string; color: string }> = {
  work: { label: '업무', color: 'var(--accent)' },
  meeting: { label: '미팅', color: 'var(--agent-writer)' },
  personal: { label: '개인', color: 'var(--success)' },
};

export function KindDot({ kind, className }: { kind: CalendarEvent['kind']; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${className ?? ''}`} style={{ background: KIND_META[kind].color }} aria-hidden="true" />;
}

function WeekStrip({ selected, today, events, onSelect }: {
  selected: string;
  today: string;
  events: CalendarEvent[];
  onSelect: (iso: string) => void;
}) {
  const days = weekOf(selected);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events]);

  return (
    <div className="flex items-stretch gap-0.5" role="group" aria-label="주간 달력">
      <IconButton icon={ChevronLeft} size="sm" label="지난주" tooltip={false} className="!h-auto !w-6 shrink-0 !rounded-[8px]" onClick={() => onSelect(addDays(selected, -7))} />
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-0.5">
        {days.map((iso) => {
          const isSelected = iso === selected;
          const isToday = iso === today;
          const dayEvents = byDay.get(iso) ?? [];
          const dayName = weekdayShort(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${longDate(iso)}${isToday ? ', 오늘' : ''}, 일정 ${dayEvents.length}개`}
              className="press relative flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-[12px] hover:bg-fill-4"
            >
              {isSelected && (
                <motion.span
                  layoutId="planner-week-selection"
                  transition={spring.snappy}
                  className="absolute inset-0 rounded-[12px] bg-[var(--selected)] shadow-[0_1px_3px_rgba(0,0,0,.12),inset_0_0.5px_0_rgba(255,255,255,.3)]"
                  aria-hidden="true"
                />
              )}
              <span className={`relative text-caption ${dayName === '일' ? 'text-danger-text' : 'text-label-2'}`}>{dayName}</span>
              <span
                className={`relative flex size-7 items-center justify-center rounded-full text-callout font-semibold ${
                  isToday ? 'bg-accent-fill text-on-accent' : 'text-label'
                }`}
              >
                {fromIso(iso).getDate()}
              </span>
              <span className="relative flex h-1.5 items-center gap-0.5" aria-hidden="true">
                {dayEvents.slice(0, 3).map((e) => (
                  <span key={e.id} className="size-1 rounded-full" style={{ background: KIND_META[e.kind].color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <IconButton icon={ChevronRight} size="sm" label="다음 주" tooltip={false} className="!h-auto !w-6 shrink-0 !rounded-[8px]" onClick={() => onSelect(addDays(selected, 7))} />
    </div>
  );
}

function EventRow({ event, overlap, onOpen, onToggle }: {
  event: CalendarEvent;
  overlap: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const meta = KIND_META[event.kind];
  return (
    <div className="group flex items-start gap-1 rounded-[12px] transition-colors duration-150 hover:bg-fill-4 focus-within:bg-fill-4">
      <button
        type="button"
        onClick={onOpen}
        disabled={isTemp(event.id)}
        aria-label={`${event.time ?? '종일'} ${event.title} 수정`}
        className="press grid min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] gap-x-2.5 rounded-[12px] py-2.5 pl-2.5 text-left"
      >
        <span className={`pt-px text-subhead font-medium tabular-nums ${event.done ? 'text-label-2' : 'text-label'}`}>{event.time ?? '종일'}</span>
        <span className="min-w-0">
          <span className={`block text-callout font-medium break-keep [overflow-wrap:anywhere] ${event.done ? 'text-label-2 line-through decoration-label-3' : 'text-label'}`}>
            {event.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-label-2">
            <span className="inline-flex items-center gap-1">
              <KindDot kind={event.kind} />
              {meta.label}
            </span>
            {event.time && event.durationMin !== undefined && <span>{durationLabel(event.durationMin)}</span>}
            {overlap && (
              <Badge tone="warning" icon={TriangleAlert}>
                시간 겹침
              </Badge>
            )}
          </span>
        </span>
      </button>
      <span className={`shrink-0 py-2.5 pr-2.5 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${event.done ? 'opacity-100' : 'opacity-0'}`}>
        <CheckCircle checked={event.done} onToggle={onToggle} size={20} label={`${event.title} ${event.done ? '완료 취소' : '완료'}`} />
      </span>
    </div>
  );
}

export function EventsPane({ planner, today, active }: { planner: PlannerState; today: string; active: boolean }) {
  const actions = usePlannerActions();
  const [chosen, setChosen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; event: CalendarEvent | null }>({ open: false, event: null });
  const selected = chosen ?? today;
  const { events, status } = planner;

  const dayEvents = useMemo(() => sortEvents(events.filter((e) => e.date === selected)), [events, selected]);
  const overlaps = useMemo(() => findOverlaps(events.filter((e) => e.date === selected)), [events, selected]);

  if (!selected) return <Material as="section" aria-label="일정" className="h-full p-3.5" />;

  return (
    <Material as="section" aria-label="일정" className="flex h-full min-h-0 flex-col p-3.5">
      <header className="mb-2.5 flex items-center justify-between gap-1 px-1">
        <div className="flex min-w-0 items-center gap-0.5">
          <h2 className="truncate text-title3 text-label">{monthLabel(selected)}</h2>
          <IconButton icon={ChevronLeft} size="sm" label="지난달" onClick={() => setChosen(addMonths(selected, -1))} />
          <IconButton icon={ChevronRight} size="sm" label="다음 달" onClick={() => setChosen(addMonths(selected, 1))} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selected !== today && (
            <Button size="sm" variant="plain" onClick={() => setChosen(null)}>
              오늘
            </Button>
          )}
          <IconButton icon={Plus} size="sm" variant="filled" label="일정 추가" onClick={() => setSheet({ open: true, event: null })} />
        </div>
      </header>

      <WeekStrip selected={selected} today={today} events={events} onSelect={setChosen} />

      <div className="mt-3 flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-subhead font-semibold text-label">
          {selected === today ? '오늘, ' : ''}
          {longDate(selected)}
        </h3>
        {dayEvents.length > 0 && <span className="shrink-0 text-footnote text-label-2 tabular-nums">{dayEvents.length}개</span>}
      </div>

      <div className="-mx-1 mt-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_16px),transparent)]">
        {status === 'error' ? (
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
        ) : status === 'loading' && events.length === 0 ? (
          <div className="space-y-3 px-2.5 py-3" aria-hidden="true">
            <span className="skeleton block h-4 w-3/4 rounded-md" />
            <span className="skeleton block h-4 w-1/2 rounded-md" />
          </div>
        ) : dayEvents.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarX2}
            title="이 날은 일정이 없어요"
            action={
              <Button size="sm" icon={CalendarPlus} onClick={() => setSheet({ open: true, event: null })}>
                일정 추가
              </Button>
            }
          />
        ) : (
          <ul>
            {dayEvents.map((event) => (
              <li key={rowKey(event.id)}>
                <EventRow
                  event={event}
                  overlap={overlaps.has(event.id)}
                  onOpen={() => setSheet({ open: true, event })}
                  onToggle={() => void actions.patchEvent(event.id, { done: !event.done })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <EventSheet
        active={active}
        open={sheet.open}
        event={sheet.event}
        defaultDate={selected}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        onSave={(input) => {
          if (sheet.event) void actions.patchEvent(sheet.event.id, input);
          else {
            void actions.addEvent(input);
            setChosen(input.date === today ? null : input.date);
          }
        }}
        onRemove={actions.removeEvent}
      />
    </Material>
  );
}
