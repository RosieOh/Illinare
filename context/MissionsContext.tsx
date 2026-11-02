'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ApprovalDecision,
  ApprovalRequest,
  MissionEvent,
  MissionSummary,
  MissionView,
} from '@/lib/contracts';
import { applyMissionEvent, isActive } from '@/lib/missions/reducer';
import { api, ClientApiError } from '@/lib/client/api';

/** EventSource.CLOSED */
const STREAM_CLOSED = 2;

/**
 * 스트림 오류 뒤 서버 상태로 맞춘다. EventSource는 스스로 재연결하므로 서버가 재시작하면
 * 끝난 미션에 영원히 다시 붙는다. 끝났으면 재연결을 멈춰야 화면이 진행 중에 머물지 않는다.
 */
export async function syncAfterStreamError(args: {
  source: Pick<EventSource, 'readyState' | 'close'>;
  fetchView: () => Promise<MissionView>;
  onView: (view: MissionView) => void;
  /** 스트림이 닫혔다. 미션이 끝났거나 다시 구독해야 한다. */
  onEnded: () => void;
  /** 서버에 이 미션이 없다. */
  onGone: () => void;
}): Promise<void> {
  const { source } = args;
  try {
    const view = await args.fetchView();
    args.onView(view);
    if (!isActive(view.status)) {
      source.close();
      args.onEnded();
    } else if (source.readyState === STREAM_CLOSED) {
      args.onEnded();
    }
  } catch (err) {
    if (err instanceof ClientApiError && err.status === 404) {
      source.close();
      args.onGone();
    } else if (source.readyState === STREAM_CLOSED) {
      args.onEnded();
    }
    // 서버가 아직 내려가 있으면 EventSource의 재연결에 맡긴다.
  }
}

const SUMMARY_POLL_MS = 4000;

interface PendingApproval {
  missionId: string;
  missionTitle: string;
  approval: ApprovalRequest;
}

interface MissionsContextValue {
  summaries: MissionSummary[];
  /** 구독 중인 미션의 실시간 상태 */
  missions: Record<string, MissionView>;
  /** 진행 중인 미션 id (최신순) */
  activeIds: string[];
  pendingApprovals: PendingApproval[];
  /** 사용자가 보고 있는 미션 */
  focusedId: string | null;
  focus: (id: string | null) => void;
  start: (goal: string) => Promise<string>;
  followup: (id: string, goal: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  decide: (missionId: string, approvalId: string, decision: ApprovalDecision, remember?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const MissionsContext = createContext<MissionsContextValue | null>(null);

export function MissionsProvider({ children }: { children: ReactNode }) {
  const [summaries, setSummaries] = useState<MissionSummary[]>([]);
  const [missions, setMissions] = useState<Record<string, MissionView>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const streams = useRef(new Map<string, EventSource>());
  /** 스냅샷을 받는 중인 미션. 같은 미션에 스트림이 두 개 열리지 않게 한다. */
  const connecting = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const { missions: list } = await api.get<{ missions: MissionSummary[] }>('/api/missions');
    // 주기적으로 부르므로 내용이 같으면 다시 그리지 않는다.
    setSummaries((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
  }, []);

  /** 스냅샷을 받은 뒤 그 지점부터 이벤트를 이어 받는다. 끝난 미션은 스냅샷만으로 충분하다. */
  const subscribe = useCallback(
    async (id: string) => {
      if (streams.current.has(id) || connecting.current.has(id)) return;
      connecting.current.add(id);
      let snapshot: MissionView;
      try {
        snapshot = await api.get<MissionView>(`/api/missions/${id}`);
      } finally {
        connecting.current.delete(id);
      }
      setMissions((prev) => ({ ...prev, [id]: snapshot }));
      if (!isActive(snapshot.status)) return;

      const source = new EventSource(`/api/missions/${id}/events?since=${snapshot.seq}`);
      streams.current.set(id, source);
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as MissionEvent;
        setMissions((prev) => {
          const current = prev[id] ?? null;
          return { ...prev, [id]: applyMissionEvent(current, event) };
        });
        if (event.type === 'mission.finished') {
          source.close();
          streams.current.delete(id);
          void refresh();
        } else if (event.type === 'plan.ready') {
          void refresh();
        }
      };
      source.onerror = () => {
        void syncAfterStreamError({
          source,
          fetchView: () => api.get<MissionView>(`/api/missions/${id}`),
          onView: (view) =>
            setMissions((prev) => {
              const current = prev[id];
              const stale = current && current.seq > view.seq && isActive(view.status);
              return stale ? prev : { ...prev, [id]: view };
            }),
          onEnded: () => {
            streams.current.delete(id);
            // 아직 진행 중이면 요약이 갱신되면서 다시 구독한다.
            void refresh().catch(() => undefined);
          },
          onGone: () => {
            streams.current.delete(id);
            setMissions((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            void refresh().catch(() => undefined);
          },
        });
      };
    },
    [refresh]
  );

  useEffect(() => {
    const active = streams.current;
    // 페이지를 새로 열어도 진행 중인 미션을 이어서 본다.
    refresh()
      .then(() => undefined)
      .catch(() => undefined);
    return () => {
      active.forEach((s) => s.close());
      active.clear();
    };
  }, [refresh]);

  // 다른 창이나 탭에서 시작한 미션의 승인 요청도 이 창에 떠야 한다. 화면이 보일 때 목록을 가볍게 확인한다.
  useEffect(() => {
    const check = () => {
      if (!document.hidden) void refresh().catch(() => undefined);
    };
    const timer = setInterval(check, SUMMARY_POLL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refresh]);

  useEffect(() => {
    for (const s of summaries) {
      if (isActive(s.status)) void subscribe(s.id).catch(() => undefined);
    }
  }, [summaries, subscribe]);

  useEffect(() => {
    if (focusedId) void subscribe(focusedId).catch(() => undefined);
  }, [focusedId, subscribe]);

  const start = useCallback(
    async (goal: string) => {
      const { id } = await api.post<{ id: string }>('/api/missions', { goal });
      setFocusedId(id);
      await subscribe(id);
      await refresh();
      return id;
    },
    [subscribe, refresh]
  );

  const followup = useCallback(
    async (id: string, goal: string) => {
      await api.post(`/api/missions/${id}/followup`, { goal });
      await subscribe(id);
      await refresh();
    },
    [subscribe, refresh]
  );

  const cancel = useCallback(
    async (id: string) => {
      await api.del(`/api/missions/${id}`);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      streams.current.get(id)?.close();
      streams.current.delete(id);
      await api.del(`/api/missions/${id}`);
      setMissions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFocusedId((cur) => (cur === id ? null : cur));
      await refresh();
    },
    [refresh]
  );

  const decide = useCallback(
    async (missionId: string, approvalId: string, decision: ApprovalDecision, remember?: boolean) => {
      await api.post(`/api/missions/${missionId}/approvals/${approvalId}`, { decision, remember });
    },
    []
  );

  const activeIds = useMemo(
    () =>
      Object.values(missions)
        .filter((m) => isActive(m.status))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((m) => m.id),
    [missions]
  );

  const pendingApprovals = useMemo(
    () =>
      Object.values(missions).flatMap((m) =>
        m.approvals.map((approval) => ({ missionId: m.id, missionTitle: m.title, approval }))
      ),
    [missions]
  );

  const value = useMemo<MissionsContextValue>(
    () => ({
      summaries,
      missions,
      activeIds,
      pendingApprovals,
      focusedId,
      focus: setFocusedId,
      start,
      followup,
      cancel,
      remove,
      decide,
      refresh,
    }),
    [summaries, missions, activeIds, pendingApprovals, focusedId, start, followup, cancel, remove, decide, refresh]
  );

  return <MissionsContext.Provider value={value}>{children}</MissionsContext.Provider>;
}

export function useMissions() {
  const ctx = useContext(MissionsContext);
  if (!ctx) throw new Error('useMissions must be used within MissionsProvider');
  return ctx;
}
