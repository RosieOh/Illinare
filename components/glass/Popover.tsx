'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { spring } from './motion';

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface Anchor {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

function floatingStyle(anchor: Anchor, placement: Placement, gap: number, halfWidth = 0): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minX = 12 + halfWidth;
  const maxX = vw - 12 - halfWidth;
  switch (placement) {
    case 'top':
      return { left: clamp(anchor.left + anchor.width / 2, minX, maxX), bottom: vh - anchor.top + gap, transform: 'translateX(-50%)' };
    case 'bottom':
      return { left: clamp(anchor.left + anchor.width / 2, minX, maxX), top: anchor.bottom + gap, transform: 'translateX(-50%)' };
    case 'left':
      return { right: vw - anchor.left + gap, top: anchor.top + anchor.height / 2, transform: 'translateY(-50%)' };
    case 'right':
      return { left: anchor.right + gap, top: anchor.top + anchor.height / 2, transform: 'translateY(-50%)' };
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function toAnchor(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
}

/** 호버 지연 타이머. 동시에 뜨는 툴팁은 하나뿐이라 모듈 전역으로 충분하다. */
let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleTooltip(fn: () => void, delay: number) {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(fn, delay);
}

function cancelTooltip() {
  clearTimeout(tooltipTimer);
}

export interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  /** 단일 요소 (ref를 받을 수 있어야 함) */
  children: ReactElement<React.HTMLAttributes<HTMLElement>>;
}

/** 호버 또는 키보드 포커스 시 잠깐 뒤에 나타나는 설명 */
export function Tooltip({ content, placement = 'top', children }: TooltipProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const show = (el: Element, delay: number) => {
    scheduleTooltip(() => {
      if (el.isConnected) setAnchor(toAnchor(el));
    }, delay);
  };
  const hide = () => {
    cancelTooltip();
    setAnchor(null);
  };

  const props = children.props;
  const trigger = cloneElement(children, {
    'aria-describedby': anchor ? id : props['aria-describedby'],
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(e);
      if (e.pointerType === 'mouse') show(e.currentTarget, 420);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      if (e.target.matches(':focus-visible')) show(e.currentTarget, 80);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <>
      {trigger}
      {anchor &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="material-thick pointer-events-none fixed z-[90] max-w-64 px-2.5 py-1.5 text-footnote font-medium text-label"
            style={{ ...floatingStyle(anchor, placement, 8, 48), borderRadius: 10 }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

export interface PopoverProps {
  /** 트리거 요소. onClick이 합쳐진다 */
  trigger: ReactElement<React.HTMLAttributes<HTMLElement>>;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: 'top' | 'bottom';
  /** 패널 너비(px). 기본 280 */
  width?: number;
  /** 스크린리더 이름 */
  label: string;
}

/** 트리거에 붙어 뜨는 작은 패널. 바깥 클릭과 Esc로 닫힌다. */
export function Popover({ trigger, children, placement = 'bottom', width = 280, label }: PopoverProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setAnchor(null);
    triggerEl?.focus?.();
  }, [triggerEl]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerEl?.contains(target)) return;
      setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onResize = () => {
      if (triggerEl) setAnchor(toAnchor(triggerEl));
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, close, triggerEl]);

  const clonedTrigger = cloneElement(trigger, {
    'aria-haspopup': 'dialog',
    'aria-expanded': Boolean(anchor),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(e);
      const el = e.currentTarget;
      setTriggerEl(el);
      setAnchor((cur) => (cur ? null : toAnchor(el)));
    },
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <>
      {clonedTrigger}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {anchor && (
              <div className="fixed z-[80]" style={{ ...floatingStyle(anchor, placement, 10, width / 2), width }}>
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-label={label}
                  className="material-thick p-3 text-callout"
                  initial={{ opacity: 0, scale: 0.95, y: placement === 'bottom' ? -6 : 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={spring.snappy}
                  style={{ transformOrigin: placement === 'bottom' ? 'top center' : 'bottom center' }}
                >
                  {typeof children === 'function' ? children(close) : children}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
