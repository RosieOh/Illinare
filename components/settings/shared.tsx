'use client';

import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Settings } from '@/lib/contracts';
import { TextField } from '@/components/glass';
import { useApp } from '@/context/AppContext';

// ─── 해시 경로: #/settings/ai ─────────────────────────────────
export const SETTINGS_SECTIONS = ['general', 'ai', 'permissions', 'memory', 'routines', 'voice', 'data', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function subscribeHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function readSection(): SettingsSection | null {
  const [view, section] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (view !== 'settings' || !section) return null;
  return (SETTINGS_SECTIONS as readonly string[]).includes(section) ? (section as SettingsSection) : null;
}

/** 해시에 적힌 항목. 없으면 null (넓은 화면은 일반을, 좁은 화면은 목록을 보여준다). */
export function useSettingsSection(): SettingsSection | null {
  return useSyncExternalStore(subscribeHash, readSection, () => null);
}

export function goToSection(section: SettingsSection | null) {
  window.location.hash = section ? `/settings/${section}` : '/settings';
}

// ─── 저장 표시 ───────────────────────────────────────────────
export const SavedNotifyContext = createContext<() => void>(() => undefined);

/** 설정을 저장하고 패널 위쪽에 "저장됨"을 잠깐 띄운다. 실패 알림은 patchSettings가 맡는다. */
export function useSave() {
  const { patchSettings } = useApp();
  const notify = useContext(SavedNotifyContext);
  return useCallback(
    async (patch: Partial<Settings>) => {
      if (await patchSettings(patch)) notify();
    },
    [patchSettings, notify]
  );
}

export function useSavedMark(): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 1600);
  }, []);
  return [visible, notify];
}

export function SavedMark({ visible }: { visible: boolean }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 text-footnote text-label-2 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {visible && (
        <>
          <Check size={13} aria-hidden="true" />
          저장됨
        </>
      )}
    </span>
  );
}

// ─── 레이아웃 조각 ───────────────────────────────────────────
/** 묶음 하나. 카드 안 카드를 만들지 않고 머리카락 선으로만 나눈다. */
export function Group({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-separator pt-4 first:border-t-0 first:pt-0">
      {title && <h3 className="text-headline text-label">{title}</h3>}
      {description && <div className={`text-subhead text-label-2 ${title ? 'mt-0.5' : ''}`}>{description}</div>}
      <div className={title || description ? 'mt-3' : ''}>{children}</div>
    </section>
  );
}

export function RowLabel({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-callout font-medium text-label">{title}</div>
      {description && <div className="mt-0.5 text-subhead text-label-2">{description}</div>}
    </div>
  );
}

/** 입력하는 동안에는 저장하지 않고, 벗어나거나 Enter를 누르면 저장한다. */
export function CommitField({
  value,
  onCommit,
  validate,
  label,
  hint,
  placeholder,
  maxLength,
}: {
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const error = draft !== null && validate ? validate(draft) : null;

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (validate?.(next)) return;
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  return (
    <TextField
      label={label}
      hint={hint}
      error={error}
      placeholder={placeholder}
      maxLength={maxLength}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
      }}
    />
  );
}
