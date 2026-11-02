'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronDown, Plus, X } from 'lucide-react';
import type { TaskPriority } from '@/lib/contracts';
import { IconButton } from '@/components/glass';
import { parseKoreanDue, shortDate } from './dates';
import { DuePicker } from './TaskRow';

export interface TaskQuickAddProps {
  today: string;
  onAdd: (input: { text: string; priority: TaskPriority; due?: string }) => void;
  placeholder?: string;
  /** 입력을 시작하면 우선순위와 기한 선택이 나타난다. 오늘 화면은 false로 기한 읽기만 쓴다. */
  showOptions?: boolean;
}

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'normal', label: '우선순위 보통' },
  { value: 'high', label: '우선순위 높음' },
  { value: 'low', label: '우선순위 낮음' },
];

/** 빠른 추가. "내일 보고서 제출"처럼 쓰면 기한을 읽어 보여주고, 잘못 읽었으면 바로 지울 수 있다. */
export function TaskQuickAdd({ today, onAdd, placeholder = '할 일 추가 (예: 내일 보고서 제출)', showOptions = true }: TaskQuickAddProps) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [manualDue, setManualDue] = useState<string | undefined>(undefined);
  const [ignoreParsed, setIgnoreParsed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (ignoreParsed || !today ? { text: text.trim() } : parseKoreanDue(text, today)), [text, today, ignoreParsed]);
  const due = manualDue ?? parsed.due;
  const hasText = text.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!hasText) return;
    onAdd({ text: (manualDue ? text.trim() : parsed.text).slice(0, 500), priority, due });
    setText('');
    setPriority('normal');
    setManualDue(undefined);
    setIgnoreParsed(false);
    input.current?.focus();
  };

  return (
    <form onSubmit={submit}>
      <div className="field flex h-10 items-center gap-1 pr-1 pl-3">
        <Plus size={16} className="shrink-0 text-label-3" aria-hidden="true" />
        <input
          ref={input}
          value={text}
          maxLength={560}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) {
              setIgnoreParsed(false);
              setManualDue(undefined);
            }
          }}
          onKeyDown={(e) => {
            // 한글 조합 중의 Enter로 제출되지 않게 막는다.
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
          placeholder={placeholder}
          aria-label="새 할 일"
          className="h-full min-w-0 flex-1 bg-transparent px-1 text-callout text-label outline-none"
        />
        {hasText && <IconButton icon={Plus} size="sm" variant="primary" label="할 일 추가" type="submit" tooltip={false} />}
      </div>

      {hasText && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {due && (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--accent-tint)] pr-1 pl-2.5 text-footnote font-medium text-accent-text">
              <CalendarDays size={12} aria-hidden="true" />
              {shortDate(due)}
              <button
                type="button"
                aria-label="기한 지우기"
                onClick={() => {
                  setManualDue(undefined);
                  setIgnoreParsed(true);
                }}
                className="press flex size-5 items-center justify-center rounded-full hover:bg-fill-3"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
          {showOptions && !due && (
            <DuePicker
              value={manualDue}
              onChange={setManualDue}
              label="기한 정하기"
              className="h-7 rounded-full bg-fill-3 px-2.5 text-footnote font-medium text-label-2 hover:text-label"
            >
              <CalendarDays size={12} aria-hidden="true" />
              기한
            </DuePicker>
          )}
          {showOptions && (
            <label className="relative inline-flex h-7 items-center rounded-full bg-fill-3 text-footnote font-medium text-label-2 hover:text-label">
              <span className="sr-only">우선순위</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="h-full appearance-none rounded-full bg-transparent pr-6 pl-2.5 outline-none"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2" aria-hidden="true" />
            </label>
          )}
        </div>
      )}
    </form>
  );
}
