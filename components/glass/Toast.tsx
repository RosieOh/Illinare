'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { spring } from './motion';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** 표시 시간(ms). 기본 4500, 오류는 8000. 0이면 직접 닫을 때까지 */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((t: ToastOptions) => void) | null>(null);

const TONE = {
  info: { icon: Info, color: 'text-accent-text' },
  success: { icon: CheckCircle2, color: 'text-success-text' },
  warning: { icon: TriangleAlert, color: 'text-warning-text' },
  danger: { icon: CircleAlert, color: 'text-danger-text' },
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (t: ToastOptions) => {
      const id = nextId.current++;
      setItems((cur) => [...cur.slice(-3), { ...t, id }]);
      const duration = t.duration ?? (t.tone === 'danger' ? 8000 : 4500);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 z-[85] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
        style={{ top: 'calc(var(--shell-top) - 4px)' }}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const { icon: Icon, color } = TONE[t.tone ?? 'info'];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 24, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97 }}
                transition={spring.gentle}
                className="material-thick pointer-events-auto flex items-start gap-2.5 p-3"
                style={{ borderRadius: 18 }}
              >
                <Icon size={17} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-callout font-semibold text-label">{t.title}</div>
                  {t.description && <div className="mt-0.5 text-subhead text-label-2">{t.description}</div>}
                  {t.action && (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick();
                        dismiss(t.id);
                      }}
                      className="press mt-1.5 rounded-md text-subhead font-semibold text-accent-text hover:underline"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="알림 닫기"
                  onClick={() => dismiss(t.id)}
                  className="press -m-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-label-3 hover:bg-fill-3 hover:text-label"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
