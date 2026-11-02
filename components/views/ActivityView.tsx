'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, History, RefreshCw, Search, SearchX } from 'lucide-react';
import { AGENTS, type AuditEntry } from '@/lib/contracts';
import { Button, EmptyState, Material, Select, Sheet, Skeleton, TextField, useToast } from '@/components/glass';
import { EntryRow } from '@/components/activity/EntryRow';
import {
  filterEntries,
  groupEntries,
  isFiltering,
  NO_FILTERS,
  RISK_LABEL,
  STATUS_LABEL,
  type ActivityFilters,
} from '@/components/activity/model';
import { useMinute } from '@/components/planner/hooks';
import { downloadJson } from '@/components/settings/download';
import { ViewHeader, ViewScroll, type ViewProps } from '@/components/shell/ViewFrame';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api, ClientApiError } from '@/lib/client/api';

const POLL_MS = 5000;
const FETCH_LIMIT = 1000;
const PAGE = 100;

const STATUS_OPTIONS = [
  { value: 'all', label: '모든 결과' },
  ...(Object.entries(STATUS_LABEL) as [AuditEntry['status'], string][]).map(([value, label]) => ({ value, label })),
];
const AGENT_OPTIONS = [
  { value: 'all', label: '모든 에이전트' },
  ...Object.values(AGENTS)
    .filter((a) => a.id !== 'conductor')
    .map((a) => ({ value: a.id, label: a.name })),
];
const RISK_OPTIONS = [
  { value: 'all', label: '모든 등급' },
  ...(Object.entries(RISK_LABEL) as [AuditEntry['risk'], string][]).map(([value, label]) => ({ value, label })),
];

export default function ActivityView({ active }: ViewProps) {
  const { navigate, bootstrap } = useApp();
  const { summaries, focus } = useMissions();
  const toast = useToast();
  // 날짜 묶음은 분 단위 갱신이면 충분하고, 숨겨지면 멈춘다.
  const minute = useMinute(active);

  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [visible, setVisible] = useState(PAGE);
  const [undoing, setUndoing] = useState<AuditEntry | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const { entries: next } = await api.get<{ entries: AuditEntry[] }>(`/api/audit?limit=${FETCH_LIMIT}`, signal);
    setEntries(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          await load(controller.signal);
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(err instanceof ClientApiError ? err.message : '활동 기록을 불러오지 못했어요.');
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, load, attempt]);

  const update = (patch: Partial<ActivityFilters>) => {
    setFilters((cur) => ({ ...cur, ...patch }));
    setVisible(PAGE);
  };

  const filtered = useMemo(() => filterEntries(entries ?? [], filters), [entries, filters]);
  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const days = useMemo(() => groupEntries(shown, minute ? minute * 60_000 : Date.now()), [shown, minute]);
  const titles = useMemo(() => new Map(summaries.map((m) => [m.id, m.title])), [summaries]);

  const openMission = (id: string) => {
    focus(id);
    navigate('missions');
  };

  const confirmUndo = async () => {
    if (!undoing) return;
    setUndoBusy(true);
    setUndoError(null);
    try {
      const { message } = await api.post<{ ok: true; message: string }>(`/api/audit/${undoing.id}/undo`);
      toast({ tone: 'success', title: '되돌렸어요', description: message });
      setUndoing(null);
      await load().catch(() => undefined);
    } catch (err) {
      setUndoError(err instanceof ClientApiError ? err.message : '되돌리지 못했어요.');
    } finally {
      setUndoBusy(false);
    }
  };

  const exportAll = async () => {
    try {
      const data = await api.get<{ entries: AuditEntry[] }>('/api/audit?all=1');
      downloadJson('illionaire-activity', data.entries);
    } catch (err) {
      toast({ tone: 'danger', title: '내보내지 못했어요', description: err instanceof ClientApiError ? err.message : undefined });
    }
  };

  const hasAny = Boolean(entries?.length);

  return (
    <ViewScroll>
      <ViewHeader
        title="활동"
        subtitle="에이전트가 내 컴퓨터에서 한 일과 거부된 일을 모두 기록해요."
        actions={
          <Button icon={Download} disabled={!hasAny} onClick={() => void exportAll()}>
            JSON 내보내기
          </Button>
        }
      />

      {error && entries && (
        <div role="status" className="material-thin mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[16px] px-4 py-2.5">
          <p className="min-w-0 text-callout text-label">
            새 기록을 불러오지 못하고 있어요. 아래는 마지막으로 받은 기록이에요.
            <span className="block text-footnote text-label-2">{error}</span>
          </p>
          <Button size="sm" icon={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
            다시 시도
          </Button>
        </div>
      )}

      {hasAny && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <TextField
            aria-label="기록 검색"
            placeholder="요약, 도구, 결과에서 찾기"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
            leading={<Search size={15} aria-hidden="true" />}
            wrapperClassName="min-w-[200px] flex-1"
          />
          <Select aria-label="결과로 거르기" options={STATUS_OPTIONS} value={filters.status} onChange={(e) => update({ status: e.target.value as ActivityFilters['status'] })} wrapperClassName="w-[132px]" />
          <Select aria-label="에이전트로 거르기" options={AGENT_OPTIONS} value={filters.agent} onChange={(e) => update({ agent: e.target.value as ActivityFilters['agent'] })} wrapperClassName="w-[150px]" />
          <Select aria-label="위험 등급으로 거르기" options={RISK_OPTIONS} value={filters.risk} onChange={(e) => update({ risk: e.target.value as ActivityFilters['risk'] })} wrapperClassName="w-[124px]" />
        </div>
      )}

      {!entries && !error && (
        <Material className="space-y-3 p-5" radius={24} aria-busy="true" aria-label="활동 기록을 불러오는 중">
          <Skeleton height={44} radius={12} />
          <Skeleton height={44} radius={12} />
          <Skeleton height={44} radius={12} />
        </Material>
      )}

      {!entries && error && (
        <Material radius={24}>
          <EmptyState
            icon={History}
            title="활동 기록을 불러오지 못했어요"
            description={error}
            action={<Button onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}
          />
        </Material>
      )}

      {entries && !hasAny && (
        <Material radius={24}>
          <EmptyState
            icon={History}
            title="아직 기록이 없어요"
            description={
              bootstrap?.mode === 'demo'
                ? '실제 미션에서 에이전트가 실행하거나 거부된 도구 호출이 여기에 남아요. 데모 미션은 아무것도 실행하지 않아 기록되지 않아요.'
                : '미션을 맡기면 에이전트가 실행하거나 거부된 도구 호출이 여기에 남아요.'
            }
          />
        </Material>
      )}

      {hasAny && filtered.length === 0 && (
        <Material radius={24}>
          <EmptyState
            icon={SearchX}
            title="조건에 맞는 기록이 없어요"
            action={<Button onClick={() => update(NO_FILTERS)}>필터 지우기</Button>}
          />
        </Material>
      )}

      {filtered.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-footnote text-label-2 tabular-nums" role="status">
              {isFiltering(filters) ? `${entries?.length.toLocaleString()}건 중 ` : ''}
              {filtered.length.toLocaleString()}건
              {(entries?.length ?? 0) >= FETCH_LIMIT ? ` · 최근 ${FETCH_LIMIT.toLocaleString()}건만 보여줘요` : ''}
            </p>
            {isFiltering(filters) && (
              <Button variant="plain" size="sm" onClick={() => update(NO_FILTERS)}>
                필터 지우기
              </Button>
            )}
          </div>

          <div className="space-y-5">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h2 className="mb-2 px-1 text-headline text-label">{day.label}</h2>
                <Material className="divide-y divide-separator px-2 py-1" radius={22}>
                  {day.groups.map((group) => {
                    const title = group.missionId ? titles.get(group.missionId) : undefined;
                    return (
                      <div key={group.missionId ?? 'none'} className="py-2">
                        <div className="flex items-center justify-between gap-3 px-2 pb-1">
                          {group.missionId && title ? (
                            <button
                              type="button"
                              onClick={() => openMission(group.missionId as string)}
                              className="press min-w-0 truncate rounded-md text-left text-subhead font-medium text-accent-text hover:underline"
                              title={`미션 열기: ${title}`}
                            >
                              {title}
                            </button>
                          ) : (
                            <span className="text-subhead font-medium text-label-2">
                              {group.missionId ? '지워진 미션' : '미션 밖의 작업'}
                            </span>
                          )}
                        </div>
                        <ul>
                          {group.entries.map((entry) => (
                            <EntryRow
                              key={entry.id}
                              entry={entry}
                              onUndo={(e) => {
                                setUndoError(null);
                                setUndoing(e);
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </Material>
              </section>
            ))}
          </div>

          {filtered.length > visible && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setVisible((v) => v + PAGE)}>
                더 보기 ({(filtered.length - visible).toLocaleString()}건 남음)
              </Button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={Boolean(undoing)}
        onClose={() => setUndoing(null)}
        title="이 작업을 되돌릴까요?"
        description={undoing?.summary}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setUndoing(null)}>취소</Button>
            <Button variant="primary" loading={undoBusy} onClick={() => void confirmUndo()}>
              되돌리기
            </Button>
          </div>
        }
      >
        <p className="text-callout text-label-2">
          파일을 이 작업 직전의 상태로 돌려놓아요. 그 뒤에 같은 파일을 고쳤다면 그 내용은 사라져요.
        </p>
        {undoError && (
          <p role="alert" className="mt-3 text-callout text-danger-text">
            {undoError}
          </p>
        )}
      </Sheet>
    </ViewScroll>
  );
}
