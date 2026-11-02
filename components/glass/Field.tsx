'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';

interface FieldFrameProps {
  label?: ReactNode;
  hint?: ReactNode;
  /** 오류 메시지. 있으면 빨간 테두리와 함께 표시되고 aria-invalid가 켜진다 */
  error?: ReactNode;
}

function Frame({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldFrameProps & { id: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-subhead font-medium text-label-2">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-m`} role="alert" className="mt-1.5 text-subhead text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-m`} className="mt-1.5 text-subhead text-label-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement>, FieldFrameProps {
  /** 입력 앞에 들어가는 아이콘 등 */
  leading?: ReactNode;
  /** 입력 뒤에 들어가는 버튼 등 */
  trailing?: ReactNode;
  /** 바깥 래퍼 클래스 */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, leading, trailing, wrapperClassName, id, className, ref, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Frame id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="field flex h-10 items-center gap-2 px-3" data-invalid={error ? '' : undefined}>
        {leading && <span className="shrink-0 text-label-3">{leading}</span>}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-m` : undefined}
          className={`h-full min-w-0 flex-1 bg-transparent text-callout outline-none ${className ?? ''}`}
          {...rest}
        />
        {trailing && <span className="shrink-0">{trailing}</span>}
      </div>
    </Frame>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldFrameProps {
  wrapperClassName?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ label, hint, error, wrapperClassName, id, className, rows = 4, ref, ...rest }: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Frame id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="field px-3 py-2.5" data-invalid={error ? '' : undefined}>
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-m` : undefined}
          className={`block w-full resize-none bg-transparent text-callout outline-none ${className ?? ''}`}
          {...rest}
        />
      </div>
    </Frame>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldFrameProps {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  wrapperClassName?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** 네이티브 select — 키보드와 OS 메뉴를 그대로 쓴다 */
export function Select({ label, hint, error, options, wrapperClassName, id, className, ref, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Frame id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="field relative flex h-10 items-center" data-invalid={error ? '' : undefined}>
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-m` : undefined}
          className={`h-full w-full rounded-[inherit] pr-9 pl-3 text-callout outline-none ${className ?? ''}`}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 text-label-3" aria-hidden="true" />
      </div>
    </Frame>
  );
}
