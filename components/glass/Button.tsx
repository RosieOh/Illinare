'use client';

import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Tooltip } from './Popover';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 앞쪽 아이콘 */
  icon?: LucideIcon;
  /** 뒤쪽 아이콘 */
  iconRight?: LucideIcon;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill bg-[linear-gradient(180deg,rgba(255,255,255,.1),transparent_55%)] text-on-accent hover:brightness-110 shadow-[0_2px_8px_rgba(0,50,140,.28),inset_0_1px_0_rgba(255,255,255,.4),inset_0_-1px_1px_rgba(0,20,70,.18)]',
  secondary: 'bg-fill-2 text-label hover:bg-fill-1 shadow-[inset_0_0_0_0.5px_var(--separator)]',
  plain: 'bg-transparent text-accent-text hover:bg-fill-3',
  danger: 'bg-danger-fill bg-[linear-gradient(180deg,rgba(255,255,255,.08),transparent_55%)] text-white hover:brightness-110 shadow-[0_2px_8px_rgba(120,0,0,.28),inset_0_1px_0_rgba(255,255,255,.34),inset_0_-1px_1px_rgba(70,0,0,.18)]',
};

const SIZE: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: 'h-8 px-3 gap-1.5 text-subhead font-[550] rounded-full', icon: 14 },
  md: { box: 'h-10 px-4 gap-2 text-callout font-[550] rounded-full', icon: 16 },
  lg: { box: 'h-12 px-6 gap-2 text-headline rounded-full', icon: 18 },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const s = SIZE[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`press inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none disabled:opacity-45 ${VARIANT[variant]} ${s.box} ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      {...rest}
    >
      {loading ? (
        <Loader2 size={s.icon} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={s.icon} aria-hidden="true" />
      )}
      {children}
      {IconRight && <IconRight size={s.icon} aria-hidden="true" />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon | ((props: { size?: number }) => ReactNode);
  /** 스크린리더와 툴팁에 쓰이는 이름 (필수) */
  label: string;
  size?: ButtonSize;
  variant?: 'plain' | 'filled' | 'primary' | 'danger';
  /** 툴팁 표시 여부. 기본 true */
  tooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const ICON_SIZE: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: 'size-8 rounded-full', icon: 15 },
  md: { box: 'size-10 rounded-full', icon: 18 },
  lg: { box: 'size-12 rounded-full', icon: 20 },
};

const ICON_VARIANT: Record<NonNullable<IconButtonProps['variant']>, string> = {
  plain: 'text-label-2 hover:bg-fill-3 hover:text-label',
  filled: 'bg-fill-2 text-label hover:bg-fill-1',
  primary: 'bg-accent-fill text-on-accent hover:brightness-110',
  danger: 'text-danger-text hover:bg-fill-3',
};

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'plain',
  tooltip = true,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const s = ICON_SIZE[size];
  const button = (
    <button
      type={type}
      aria-label={label}
      className={`press inline-flex shrink-0 items-center justify-center disabled:opacity-40 ${s.box} ${ICON_VARIANT[variant]} ${className ?? ''}`}
      {...rest}
    >
      <Icon size={s.icon} aria-hidden="true" />
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
