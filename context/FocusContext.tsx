'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useToast } from '@/components/glass';
import { toIso } from '@/components/planner/dates';
import { useSecondClock } from '@/components/planner/hooks';
import {
  completeSession,
  initialFocusState,
  isFinished,
  pauseFocus,
  remainingAt,
  resetFocus,
  reviveFocusState,
  rollDay,
  SESSIONS,
  startFocus,
  switchSession,
  type FocusSession,
  type FocusState,
} from '@/components/planner/focusLogic';

/**
 * 집중 타이머. 화면을 옮겨도, 탭이 느려져도, 새로고침해도 이어진다.
 * 상태는 이 기기에만 저장하고 서버로 보내지 않는다.
 */
const STORAGE_KEY = 'illionaire_focus';
const NOTIFY_ASKED_KEY = 'illionaire_focus_notify_asked';

function today(): string {
  return toIso(new Date());
}

function loadState(): FocusState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? reviveFocusState(JSON.parse(raw)) : initialFocusState();
  } catch {
    return initialFocusState();
  }
}

function saveState(state: FocusState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 저장이 막혀도 이번 세션의 타이머는 동작한다 */
  }
}

// 외부 저장소 — 렌더 중에 localStorage를 읽지 않으면서 새로고침 후에도 이어 간다.
const SERVER_STATE = initialFocusState();
let current: FocusState | null = null;
const listeners = new Set<() => void>();

function read(): FocusState {
  current ??= loadState();
  return current;
}

function write(next: FocusState) {
  current = next;
  saveState(next);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // 다른 창에서 바꾼 값도 따라간다.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    current = loadState();
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** 짧고 부드러운 두 음. 세션을 시작하며 만든 AudioContext를 쓴다 (브라우저 자동 재생 제한). */
function chime(ctx: AudioContext) {
  const start = ctx.currentTime;
  [659.25, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const at = start + i * 0.18;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.09, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.8);
  });
}

interface FocusContextValue {
  state: FocusState;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  selectSession: (session: FocusSession) => void;
  setSound: (on: boolean) => void;
  /** 세션을 시작한 뒤 알림 허용을 물어볼 차례인가 */
  notifyPrompt: boolean;
  acceptNotify: () => void;
  dismissNotify: () => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const state = useSyncExternalStore(subscribe, read, () => SERVER_STATE);
  const [notifyPrompt, setNotifyPrompt] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const finish = useCallback(() => {
    const before = read();
    const { state: next, finished, next: upcoming } = completeSession(before, today());
    write(next);
    const nextLabel = SESSIONS[upcoming].label;
    const title = finished === 'focus' ? '집중 세션을 끝냈어요' : '휴식이 끝났어요';
    const body = `다음은 ${nextLabel} ${SESSIONS[upcoming].minutes}분이에요.`;
    toast({ tone: 'success', title, description: body });
    if (next.sound && audio.current) chime(audio.current);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const notification = new Notification(title, { body, silent: !next.sound });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  }, [toast]);

  // 끝나는 시각에 맞춰 깨어난다. 탭이 느려져 늦게 깨어나도 끝나는 시각은 그대로이고, 돌아오면 바로 확인한다.
  const endsAt = state.status === 'running' ? state.endsAt : null;
  useEffect(() => {
    if (endsAt === null) return;
    const check = () => {
      if (isFinished(read(), Date.now())) finish();
    };
    const timer = setTimeout(check, Math.max(0, endsAt - Date.now()) + 50);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [endsAt, finish]);

  const start = useCallback(() => {
    if (typeof window.AudioContext !== 'undefined') {
      audio.current ??= new window.AudioContext();
      void audio.current.resume().catch(() => undefined);
    }
    write(startFocus(rollDay(read(), today()), Date.now()));
    // 처음 시작할 때 한 번만, 왜 필요한지 설명한 뒤에 묻는다.
    try {
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default' &&
        !window.localStorage.getItem(NOTIFY_ASKED_KEY)
      ) {
        setNotifyPrompt(true);
      }
    } catch {
      /* 저장 공간을 못 쓰면 묻지 않는다 */
    }
  }, []);

  const markAsked = useCallback(() => {
    setNotifyPrompt(false);
    try {
      window.localStorage.setItem(NOTIFY_ASKED_KEY, '1');
    } catch {
      /* 다음에 다시 물어도 해롭지 않다 */
    }
  }, []);

  const acceptNotify = useCallback(() => {
    markAsked();
    void Notification.requestPermission().then((result) => {
      if (result === 'denied') {
        toast({ title: '알림이 꺼져 있어요', description: '브라우저 설정에서 켤 수 있어요. 앱 안에서는 계속 알려 드려요.' });
      }
    });
  }, [markAsked, toast]);

  /** 진행 중인 세션을 끊는 동작은 되돌릴 수 있게 한다. 끝나는 시각이 그대로라 되돌리면 시간도 이어진다. */
  const interrupt = useCallback(
    (next: FocusState, title: string) => {
      const before = read();
      write(next);
      const hadProgress = before.status !== 'idle';
      if (hadProgress) toast({ title, action: { label: '되돌리기', onClick: () => write(before) } });
    },
    [toast]
  );

  const pause = useCallback(() => write(pauseFocus(read(), Date.now())), []);
  const reset = useCallback(() => interrupt(resetFocus(read()), '타이머를 처음으로 돌렸어요'), [interrupt]);
  const skip = useCallback(() => interrupt(completeSession(read(), today(), false).state, '세션을 건너뛰었어요'), [interrupt]);
  const selectSession = useCallback(
    (session: FocusSession) => {
      if (read().session !== session) interrupt(switchSession(read(), session), '진행 중이던 세션을 멈췄어요');
    },
    [interrupt]
  );
  const setSound = useCallback((on: boolean) => write({ ...read(), sound: on }), []);

  const value = useMemo<FocusContextValue>(
    () => ({ state, start, pause, reset, skip, selectSession, setSound, notifyPrompt, acceptNotify, dismissNotify: markAsked }),
    [state, start, pause, reset, skip, selectSession, setSound, notifyPrompt, acceptNotify, markAsked]
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocusTimer() {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useFocusTimer must be used within FocusProvider');
  return ctx;
}

/** 남은 시간(ms). 1초마다 갱신되므로 숫자를 그리는 작은 컴포넌트에서만 쓴다. 숨겨진 뷰는 active=false. */
export function useFocusRemaining(active = true): number {
  const { state } = useFocusTimer();
  const now = useSecondClock(active);
  // 시계가 준비되기 전 한 프레임 동안은 남은 시간을 줄이지 않는다.
  return remainingAt(state, now || (state.endsAt ?? 0) - state.remainingMs);
}
