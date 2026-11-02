'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { LiquidGlass } from './LiquidGlass';
import { spring } from './motion';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** 제목 (접근성 이름으로도 쓰임) */
  title?: ReactNode;
  /** 제목이 화면에 없을 때의 접근성 이름 */
  ariaLabel?: string;
  /** 제목 아래 설명 */
  description?: ReactNode;
  /** center: 가운데 시트, side: 오른쪽 패널, top: 위쪽 정렬 (팔레트) */
  variant?: 'center' | 'side' | 'top';
  /** 패널 최대 너비(px). 기본 520 */
  width?: number;
  /** false면 Esc와 바깥 클릭으로 닫히지 않는다 (온보딩 등) */
  dismissible?: boolean;
  /** 우측 상단 닫기 버튼 표시 */
  showClose?: boolean;
  /** 글이 짧은 표면(팔레트, 온보딩)은 얇은 유리와 굴절을 쓴다. 기본은 글을 읽기 좋은 두꺼운 유리 */
  glass?: 'reading' | 'clear';
  /** 하단 고정 영역 */
  footer?: ReactNode;
  /** 열릴 때 포커스를 줄 요소. 없으면 안쪽의 autoFocus 요소, 그것도 없으면 패널 자체 */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** 내부 여백 제거 */
  bare?: boolean;
  children: ReactNode;
}

/** 모달 시트. 포커스를 가두고 닫으면 원래 자리로 돌려준다. */
export function Sheet(props: SheetProps) {
  const { open } = props;
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{open && <SheetPanel {...props} />}</AnimatePresence>, document.body);
}

function SheetPanel({
  onClose,
  title,
  ariaLabel,
  description,
  variant = 'center',
  width = 520,
  dismissible = true,
  showClose = true,
  footer,
  initialFocus,
  bare,
  glass = 'reading',
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // autoFocus는 커밋 중에 포커스를 옮기므로 돌아갈 자리는 렌더 시점에 잡아 둔다.
  const [previously] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const panel = panelRef.current;
    if (initialFocus?.current) initialFocus.current.focus({ preventScroll: true });
    else if (!panel?.contains(document.activeElement)) panel?.focus({ preventScroll: true });
    return () => {
      previously?.focus?.({ preventScroll: true });
    };
  }, [initialFocus, previously]);

  // 시트는 뷰 밖으로 포털되어 숨은 뷰의 inert가 닿지 않는다. 다른 화면으로 가면 닫는다.
  // 화면 이동과 함께 열리는 시트(승인 자세히)가 바로 닫히지 않도록 열린 직후의 이동은 무시한다.
  const [openedAt] = useState(() => performance.now());
  useEffect(() => {
    if (!dismissible) return;
    const onNavigate = () => {
      if (performance.now() - openedAt > 400) onClose();
    };
    window.addEventListener('hashchange', onNavigate);
    return () => window.removeEventListener('hashchange', onNavigate);
  }, [dismissible, onClose, openedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dismissible, onClose]);

  const placement =
    variant === 'side'
      ? 'items-stretch justify-end p-3'
      : variant === 'top'
        ? 'items-start justify-center px-4 pt-[12vh]'
        : 'items-center justify-center p-4';

  const motionProps =
    variant === 'side'
      ? { initial: { x: 48, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 48, opacity: 0 } }
      : { initial: { scale: 0.96, opacity: 0, y: 10 }, animate: { scale: 1, opacity: 1, y: 0 }, exit: { scale: 0.98, opacity: 0, y: 4 } };

  return (
    <motion.div
      className={`fixed inset-0 z-[70] flex ${placement}`}
      style={{ background: 'var(--scrim)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="flex max-h-full w-full flex-col outline-none"
        style={{ maxWidth: width }}
        transition={spring.morph}
        {...motionProps}
      >
        {/* 시트는 기능 계층이다. 글이 많으면 두꺼운 틴트만 쓰고, 짧은 표면은 뒤가 비치는 유리로 둔다. */}
        <LiquidGlass
          tint={glass === 'clear' ? 'sheet' : 'thick'}
          refract={glass === 'clear'}
          bezel={18}
          strength={36}
          radius={variant === 'side' ? 24 : 28}
          className="flex min-h-0 w-full flex-1 flex-col"
          style={{ boxShadow: 'var(--sheet-shadow)' }}
        >
        {(title || (showClose && dismissible)) && (
          <header className="flex shrink-0 items-start gap-3 px-6 pt-5 pb-2">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="text-title3 text-label">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-callout text-label-2">
                  {description}
                </p>
              )}
            </div>
            {showClose && dismissible && <IconButton icon={X} label="닫기" size="sm" variant="filled" tooltip={false} onClick={onClose} />}
          </header>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${bare ? '' : 'px-6 pt-2 pb-6'}`}>{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 px-6 pb-5">{footer}</footer>}
        </LiquidGlass>
      </motion.div>
    </motion.div>
  );
}
