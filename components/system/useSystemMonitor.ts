'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SystemSnapshot } from '@/lib/contracts';
import { api, ClientApiError } from '@/lib/client/api';
import { pushSample, SAMPLE_INTERVAL_MS, type Sample } from './model';

export interface MonitorState {
  snapshot: SystemSnapshot | null;
  history: Sample[];
  /** 가장 최근 요청의 실패 메시지. 다시 성공하면 지워진다 */
  error: string | null;
  lastOkAt: number | null;
}

const INITIAL: MonitorState = { snapshot: null, history: [], error: null, lastOkAt: null };

/** 화면에 보이는 동안에만 2초마다 측정값을 받는다. 숨은 탭에서는 쉰다. */
export function useSystemMonitor(active: boolean) {
  const [state, setState] = useState<MonitorState>(INITIAL);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(tick, SAMPLE_INTERVAL_MS);
        return;
      }
      try {
        const snapshot = await api.get<SystemSnapshot>('/api/system', controller.signal);
        setState((cur) => ({
          snapshot,
          history: pushSample(cur.history, snapshot),
          error: null,
          lastOkAt: snapshot.at,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof ClientApiError ? err.message : '측정값을 받지 못했어요.';
        setState((cur) => ({ ...cur, error: message }));
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, SAMPLE_INTERVAL_MS);
    };

    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
