'use client';

import { useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, CalendarPlus, Flag, Trash2, Waypoints } from 'lucide-react';
import type { Task, TaskPriority } from '@/lib/contracts';
import { IconButton, Tooltip } from '@/components/glass';
import { dueLabel, shortDate, type DueLabel } from './dates';
import { isTemp } from './store';

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: '높음', normal: '보통', low: '낮음' };
const NEXT_PRIORITY: Record<TaskPriority, TaskPriority> = { normal: 'high', high: 'low', low: 'normal' };

const DUE_TONE: Record<DueLabel['tone'], string> = {
  overdue: 'text-danger-text font-medium',
  today: 'text-accent-text font-medium',
  soon: 'text-label-2',
  later: 'text-label-2',
};

/** 체크 원. 끝내면 원이 채워지고 체크 표시가 그려진다. */
export function CheckCircle({ checked, label, onToggle, size = 22, tone = 'accent' }: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  size?: number;
  tone?: 'accent' | 'success';
}) {
  const fill = tone === 'success' ? 'var(--success)' : 'var(--accent-fill)';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="press relative flex shrink-0 items-center justify-center rounded-full before:absolute before:-inset-2 before:content-['']"
      style={{ width: size, height: size }}
    >
      <motion.span
        className="absolute inset-0 rounded-full"
        initial={false}
        animate={{ backgroundColor: checked ? fill : 'rgba(0,0,0,0)', scale: checked ? [1, 1.12, 1] : 1 }}
        transition={{ duration: 0.32 }}
        style={{ boxShadow: checked ? 'none' : 'inset 0 0 0 1.5px var(--label-3)' }}
      />
      <svg viewBox="0 0 24 24" className="relative size-[70%]" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <motion.path
          d="M5 12.5 10 17.5 19 7.5"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.26, ease: 'easeOut' }}
        />
      </svg>
    </button>
  );
}

/** 네이티브 날짜 선택기를 여는 작은 버튼. */
export function DuePicker({ value, onChange, label, className, children }: {
  value?: string;
  onChange: (value: string | undefined) => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          try {
            input.current?.showPicker();
          } catch {
            input.current?.focus();
          }
        }}
        className={`press inline-flex items-center gap-1 rounded-md ${className ?? ''}`}
      >
        {children}
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
      />
    </span>
  );
}

export interface TaskRowProps {
  task: Task;
  today: string;
  /** 오늘 화면용: 체크와 기한만 남긴다 */
  compact?: boolean;
  onToggle: () => void;
  onPatch?: (patch: Partial<Task>) => void;
  onRemove?: () => void;
  onOpenMission?: (missionId: string) => void;
}

export function TaskRow({ task, today, compact, onToggle, onPatch, onRemove, onOpenMission }: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const due = task.due ? dueLabel(task.due, today) : null;
  const pending = isTemp(task.id);

  return (
    <div className={`group relative flex items-start gap-3 rounded-[12px] [@media(hover:none)]:flex-wrap px-2.5 ${compact ? 'py-1.5' : 'py-2.5'} transition-colors duration-150 hover:bg-fill-4 focus-within:bg-fill-4`}>
      <span className="mt-px">
        <CheckCircle checked={task.done} onToggle={onToggle} label={`${task.text} ${task.done ? '완료 취소' : '완료'}`} />
      </span>

      <div className="min-w-0 flex-1">
        {editing && onPatch ? (
          <TaskTextEditor
            value={task.text}
            onCancel={() => setEditing(false)}
            onSave={(text) => {
              setEditing(false);
              if (text !== task.text) onPatch({ text });
            }}
          />
        ) : onPatch ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${task.text} 수정`}
            className={`block w-full cursor-text rounded-[6px] text-left text-callout break-keep [overflow-wrap:anywhere] ${task.done ? 'text-label-2 line-through decoration-label-3' : 'text-label'}`}
          >
            {task.text}
          </button>
        ) : (
          <p className={`text-callout break-keep [overflow-wrap:anywhere] ${task.done ? 'text-label-2 line-through decoration-label-3' : 'text-label'}`}>
            {task.text}
          </p>
        )}

        {!compact && (due || task.missionId || task.priority !== 'normal') && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-footnote">
            {due &&
              (onPatch ? (
                <DuePicker
                  value={task.due}
                  onChange={(value) => onPatch({ due: value })}
                  label={`기한 ${shortDate(task.due as string)}, 눌러서 바꾸기`}
                  className={task.done ? 'text-label-2' : DUE_TONE[due.tone]}
                >
                  {due.text}
                </DuePicker>
              ) : (
                <span className={task.done ? 'text-label-2' : DUE_TONE[due.tone]}>{due.text}</span>
              ))}
            {task.priority !== 'normal' && (
              <span className={`inline-flex items-center gap-1 ${task.priority === 'high' ? 'text-danger-text' : 'text-label-2'}`}>
                {task.priority === 'high' ? <Flag size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
                {PRIORITY_LABEL[task.priority]}
              </span>
            )}
            {task.missionId &&
              (onOpenMission ? (
                <button
                  type="button"
                  onClick={() => onOpenMission(task.missionId as string)}
                  className="press inline-flex items-center gap-1 rounded-md text-accent-text hover:underline"
                >
                  <Waypoints size={11} aria-hidden="true" />
                  미션에서 추가됨
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-label-2">
                  <Waypoints size={11} aria-hidden="true" />
                  미션에서 추가됨
                </span>
              ))}
          </div>
        )}
      </div>

      {compact && due && (
        <span className={`shrink-0 pt-px text-footnote ${task.done ? 'text-label-2' : DUE_TONE[due.tone]}`}>{due.text}</span>
      )}

      {!compact && onPatch && onRemove && !editing && (
        <div className="material-thick absolute top-1 right-1 flex items-center gap-0.5 !rounded-[11px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:basis-full [@media(hover:none)]:justify-end [@media(hover:none)]:!bg-transparent [@media(hover:none)]:opacity-100 [@media(hover:none)]:!shadow-none">
          {!task.due && (
            <DuePicker value={task.due} onChange={(value) => onPatch({ due: value })} label={`${task.text} 기한 정하기`} className="size-8 justify-center rounded-[10px] text-label-2 hover:bg-fill-3 hover:text-label">
              <Tooltip content="기한 정하기">
                <CalendarPlus size={15} aria-hidden="true" />
              </Tooltip>
            </DuePicker>
          )}
          <Tooltip content="우선순위 바꾸기">
            <IconButton
              icon={Flag}
              size="sm"
              tooltip={false}
              label={`우선순위 ${PRIORITY_LABEL[task.priority]}, 눌러서 ${PRIORITY_LABEL[NEXT_PRIORITY[task.priority]]}으로 바꾸기`}
              onClick={() => onPatch({ priority: NEXT_PRIORITY[task.priority] })}
            />
          </Tooltip>
          <Tooltip content="삭제">
            <IconButton icon={Trash2} size="sm" tooltip={false} label={`${task.text} 삭제`} disabled={pending} onClick={onRemove} />
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function TaskTextEditor({ value, onSave, onCancel }: { value: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) return;
    const trimmed = text.trim();
    if (trimmed) onSave(trimmed);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={text}
      aria-label="할 일 내용"
      maxLength={500}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        // 한글 조합 중의 Enter는 글자를 확정할 뿐이다.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          onCancel();
        }
      }}
      className="block w-full rounded-[6px] bg-fill-3 px-1.5 py-0.5 text-callout text-label outline-none focus:shadow-[0_0_0_2px_var(--accent)]"
    />
  );
}

export function TaskRowSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3 px-2.5 py-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="skeleton size-[22px] rounded-full" />
          <span className="skeleton h-3.5 rounded-md" style={{ width: `${70 - i * 12}%` }} />
        </div>
      ))}
    </div>
  );
}
