import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// ─── Badge ───────────────────────────────────────────────────
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  /** 앞에 작은 점 표시 */
  dot?: boolean;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

const BADGE: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'bg-fill-2 text-label', dot: 'var(--label-3)' },
  accent: { box: 'bg-[var(--accent-tint)] text-accent-text', dot: 'var(--accent)' },
  success: { box: 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-success-text', dot: 'var(--success)' },
  warning: { box: 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning-text', dot: 'var(--warning)' },
  danger: { box: 'bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-danger-text', dot: 'var(--danger)' },
};

export function Badge({ tone = 'neutral', dot, icon: Icon, className, children }: BadgeProps) {
  const t = BADGE[tone];
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-footnote font-medium whitespace-nowrap ${t.box} ${className ?? ''}`}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: t.dot }} aria-hidden="true" />}
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────
export function Skeleton({ width, height = 14, radius, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span className={`skeleton ${className ?? ''}`} style={style} aria-hidden="true" />;
}

// ─── EmptyState ──────────────────────────────────────────────
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** 버튼 등 */
  action?: ReactNode;
  /** compact: 카드 안에 들어가는 작은 형태 */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-1.5 py-6' : 'gap-2 py-14'} ${className ?? ''}`}>
      {Icon && (
        <span className={`mb-1 flex items-center justify-center rounded-full bg-fill-3 text-label-2 ${compact ? 'size-9' : 'size-12'}`}>
          <Icon size={compact ? 17 : 22} aria-hidden="true" />
        </span>
      )}
      <p className={`${compact ? 'text-callout' : 'text-headline'} font-semibold text-label`}>{title}</p>
      {description && <p className="max-w-sm text-callout text-label-2">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ─── Kbd ─────────────────────────────────────────────────────
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-fill-3 px-1 font-sans text-caption font-medium text-label-2 shadow-[inset_0_0_0_0.5px_var(--separator)] ${className ?? ''}`}
    >
      {children}
    </kbd>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────
export interface ProgressBarProps {
  /** 0~1. 생략하면 미확정 진행 표시 */
  value?: number;
  /** 스크린리더 이름 (필수) */
  label: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** 굵기(px). 기본 6 */
  height?: number;
  className?: string;
}

const BAR: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function ProgressBar({ value, label, tone = 'accent', height = 6, className }: ProgressBarProps) {
  const pct = value === undefined ? undefined : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`relative overflow-hidden rounded-full bg-fill-2 ${className ?? ''}`}
      style={{ height, color: BAR[tone] }}
    >
      {pct === undefined ? (
        <span className="progress-indeterminate" />
      ) : (
        <span
          className="block h-full rounded-full bg-current transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
