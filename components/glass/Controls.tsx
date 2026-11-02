'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { spring } from './motion';

// ─── Segmented ───────────────────────────────────────────────
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 스크린리더 이름 (필수) */
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

/** 선택 표시가 액체처럼 옮겨 가는 세그먼트 컨트롤 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  fullWidth,
  className,
}: SegmentedProps<T>) {
  const groupId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const h = size === 'sm' ? 'h-7 text-footnote' : 'h-8.5 text-subhead';

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative inline-flex rounded-[11px] bg-fill-3 p-0.5 ${fullWidth ? 'flex w-full' : ''} ${className ?? ''}`}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`press relative flex items-center justify-center gap-1.5 rounded-[9px] px-3 font-medium whitespace-nowrap ${h} ${fullWidth ? 'flex-1' : ''} ${selected ? 'text-label' : 'text-label-2 hover:text-label'}`}
          >
            {selected && (
              <motion.span
                layoutId={`segmented-${groupId}`}
                transition={spring.snappy}
                className="absolute inset-0 rounded-[9px] bg-[var(--selected)] bg-[linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,0)_60%)] shadow-[0_1px_3px_rgba(0,0,0,.14),inset_0_0.5px_0_rgba(255,255,255,.35)]"
                aria-hidden="true"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {Icon && <Icon size={size === 'sm' ? 13 : 15} aria-hidden="true" />}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 눈에 보이는 라벨. 없으면 ariaLabel 필수 */
  label?: ReactNode;
  description?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, label, description, ariaLabel, disabled, className }: ToggleProps) {
  const id = useId();
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={label ? `${id}-l` : undefined}
      aria-describedby={description ? `${id}-d` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press relative h-[26px] w-[44px] shrink-0 rounded-full disabled:opacity-40 ${checked ? 'bg-accent-fill' : 'bg-fill-1'}`}
      style={{ boxShadow: 'inset 0 0 0 0.5px var(--separator)' }}
    >
      <motion.span
        className="absolute top-[2px] block size-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,.28),0_0_0_0.5px_rgba(0,0,0,.05)]"
        animate={{ left: checked ? 20 : 2 }}
        transition={spring.snappy}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div className={`flex items-center justify-between gap-4 ${className ?? ''}`}>
      <div className="min-w-0">
        <div id={`${id}-l`} className="text-callout font-medium text-label">
          {label}
        </div>
        {description && (
          <div id={`${id}-d`} className="mt-0.5 text-subhead text-label-2">
            {description}
          </div>
        )}
      </div>
      {control}
    </div>
  );
}
