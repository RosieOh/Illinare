'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Trash2, Waypoints } from 'lucide-react';
import type { CalendarEvent } from '@/lib/contracts';
import { Button, Segmented, Select, Sheet, TextField, Toggle, type SegmentedOption } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { durationLabel } from './logic';
import type { EventInput } from './store';

const KIND_OPTIONS: SegmentedOption<CalendarEvent['kind']>[] = [
  { value: 'work', label: '업무' },
  { value: 'meeting', label: '미팅' },
  { value: 'personal', label: '개인' },
];

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export interface EventSheetProps {
  /** 이 시트를 띄운 뷰가 보이는가. 시트는 뷰 바깥에 그려지므로 뷰가 숨겨지면 닫는다. */
  active: boolean;
  open: boolean;
  /** 있으면 수정, 없으면 새 일정 */
  event: CalendarEvent | null;
  /** 새 일정의 기본 날짜 */
  defaultDate: string;
  onClose: () => void;
  onSave: (input: EventInput) => void;
  onRemove?: (event: CalendarEvent) => void;
}

export function EventSheet({ active, open, event, defaultDate, onClose, onSave, onRemove }: EventSheetProps) {
  const formId = useId();
  const { navigate } = useApp();
  const { focus } = useMissions();

  useEffect(() => {
    if (open && !active) onClose();
  }, [open, active, onClose]);

  return (
    <Sheet
      open={open && active}
      onClose={onClose}
      title={event ? '일정 수정' : '새 일정'}
      width={460}
      footer={
        <div className="flex w-full items-center gap-2">
          {event && onRemove && (
            <Button
              variant="plain"
              icon={Trash2}
              className="!text-danger-text"
              onClick={() => {
                onRemove(event);
                onClose();
              }}
            >
              삭제
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={onClose}>취소</Button>
            <Button variant="primary" type="submit" form={formId}>
              {event ? '저장' : '추가'}
            </Button>
          </div>
        </div>
      }
    >
      {/* 열 때마다 입력값을 새로 시작한다 */}
      <EventForm
        key={event?.id ?? `new-${defaultDate}`}
        formId={formId}
        event={event}
        defaultDate={defaultDate}
        onSubmit={(input) => {
          onSave(input);
          onClose();
        }}
      />
      {event?.missionId && (
        <button
          type="button"
          onClick={() => {
            focus(event.missionId as string);
            navigate('missions');
            onClose();
          }}
          className="press mt-3 inline-flex items-center gap-1.5 rounded-md text-subhead text-accent-text hover:underline"
        >
          <Waypoints size={13} aria-hidden="true" />
          미션에서 추가됨
        </button>
      )}
    </Sheet>
  );
}

function EventForm({ formId, event, defaultDate, onSubmit }: {
  formId: string;
  event: CalendarEvent | null;
  defaultDate: string;
  onSubmit: (input: EventInput) => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(event ? !event.time : false);
  const [time, setTime] = useState(event?.time ?? '09:00');
  const [duration, setDuration] = useState(event?.durationMin ?? 60);
  const [kind, setKind] = useState<CalendarEvent['kind']>(event?.kind ?? 'work');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const titleInput = useRef<HTMLInputElement>(null);

  const durationOptions = (DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)).map((m) => ({
    value: String(m),
    label: durationLabel(m),
  }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    const titleProblem = trimmed ? undefined : '일정 이름을 적어 주세요.';
    const dateProblem = date ? undefined : '날짜를 골라 주세요.';
    setTitleError(titleProblem);
    setDateError(dateProblem);
    if (titleProblem) titleInput.current?.focus();
    if (titleProblem || dateProblem) return;
    onSubmit({
      title: trimmed,
      date,
      kind,
      time: allDay ? undefined : time,
      durationMin: allDay ? undefined : duration,
    });
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
      <TextField
        ref={titleInput}
        autoFocus
        label="이름"
        value={title}
        maxLength={200}
        error={titleError}
        placeholder="예: 디자인 리뷰"
        onChange={(e) => {
          setTitle(e.target.value);
          if (titleError) setTitleError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
        }}
      />
      <TextField
        label="날짜"
        type="date"
        value={date}
        error={dateError}
        onChange={(e) => {
          setDate(e.target.value);
          if (dateError) setDateError(undefined);
        }}
      />
      <Toggle label="종일" checked={allDay} onChange={setAllDay} />
      {!allDay && (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="시작" type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} />
          <Select
            label="소요 시간"
            value={String(duration)}
            options={durationOptions}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>
      )}
      <div>
        <p className="mb-1.5 text-subhead font-medium text-label-2">
          종류
        </p>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} label="일정 종류" fullWidth />
      </div>
    </form>
  );
}
