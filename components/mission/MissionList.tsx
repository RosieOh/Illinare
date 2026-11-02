'use client';

import { useMemo, useState } from 'react';
import { Search, Square, Trash2 } from 'lucide-react';
import type { MissionStatus, MissionSummary } from '@/lib/contracts';
import { AgentAvatar, Badge, EmptyState, IconButton, TextField } from '@/components/glass';
import { useMissions } from '@/context/MissionsContext';
import { formatCost, formatRelative } from '@/lib/client/format';
import { isActive } from '@/lib/missions/reducer';
import { useNow } from '@/utils/useNow';
import { MISSION_STATUS_LABEL } from './status';

const DOT: Record<MissionStatus, string> = {
  planning: 'var(--accent)',
  awaiting_plan: 'var(--warning)',
  running: 'var(--accent)',
  awaiting_approval: 'var(--warning)',
  synthesizing: 'var(--accent)',
  done: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--label-3)',
};

export interface MissionRow extends MissionSummary {
  /** 실시간 스트림과 합친 현재 상태 */
  liveStatus: MissionStatus;
}

/** 요약 목록은 조금 늦게 갱신되므로 구독 중인 미션의 최신 값을 덧씌운다. */
export function useMissionRows(): MissionRow[] {
  const { summaries, missions } = useMissions();
  return useMemo(() => {
    const seen = new Set(summaries.map((s) => s.id));
    const rows: MissionRow[] = summaries.map((s) => {
      const live = missions[s.id];
      const agents = live?.plan ? Array.from(new Set(live.plan.steps.map((step) => step.agent))) : s.agents;
      return {
        ...s,
        title: live?.title ?? s.title,
        agents,
        costUsd: live?.usage.costUsd ?? s.costUsd,
        pendingApprovals: live?.approvals.length ?? s.pendingApprovals,
        updatedAt: live?.updatedAt ?? s.updatedAt,
        liveStatus: live?.approvals.length ? 'awaiting_approval' : (live?.status ?? s.status),
      };
    });
    // 막 시작해 아직 요약에 없는 미션도 바로 보여준다.
    for (const m of Object.values(missions)) {
      if (seen.has(m.id)) continue;
      rows.unshift({
        id: m.id,
        goal: m.goal,
        title: m.title,
        status: m.status,
        mode: m.mode,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        finishedAt: m.finishedAt,
        costUsd: m.usage.costUsd,
        pendingApprovals: m.approvals.length,
        agents: m.plan ? Array.from(new Set(m.plan.steps.map((s) => s.agent))) : [],
        liveStatus: m.approvals.length ? 'awaiting_approval' : m.status,
      });
    }
    return rows;
  }, [summaries, missions]);
}

function Row({
  row,
  selected,
  now,
  onSelect,
  onCancel,
  onDelete,
}: {
  row: MissionRow;
  selected: boolean;
  now: number;
  onSelect: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const running = isActive(row.liveStatus);
  return (
    <li className="mission-row relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`press flex w-full items-start gap-2.5 rounded-[14px] py-2 pr-9 pl-2.5 text-left ${selected ? 'bg-[var(--selected)] shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'hover:bg-fill-4'}`}
      >
        <span className="relative mt-[7px] flex size-2.5 shrink-0" aria-hidden="true">
          {running && !row.pendingApprovals && <span className="absolute inset-0 animate-ping rounded-full opacity-50" style={{ background: DOT[row.liveStatus] }} />}
          <span className="relative size-2.5 rounded-full" style={{ background: DOT[row.liveStatus] }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-callout font-medium text-label">{row.title || row.goal}</span>
          <span className="sr-only-live">{MISSION_STATUS_LABEL[row.liveStatus]}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-footnote text-label-2">
            {row.agents.length > 0 && (
              <span className="flex shrink-0" aria-hidden="true">
                {row.agents.slice(0, 4).map((agent, i) => (
                  <AgentAvatar key={agent} agent={agent} size={16} decorative className={i ? '-ml-1' : ''} style={{ zIndex: 4 - i }} />
                ))}
              </span>
            )}
            {now > 0 && <span className="shrink-0">{formatRelative(row.createdAt, now)}</span>}
            {row.mode === 'live' && row.costUsd > 0 && <span className="shrink-0">{formatCost(row.costUsd)}</span>}
            {row.pendingApprovals > 0 && (
              <Badge tone="warning" className="approval-pill !h-[18px] !px-1.5 !text-caption">
                승인 {row.pendingApprovals}
              </Badge>
            )}
          </span>
        </span>
      </button>
      <span className="mission-row-action absolute top-1.5 right-1.5">
        {running ? (
          <IconButton icon={Square} label={`${row.title || '미션'} 멈추기`} size="sm" tooltip={false} className="!size-7 !rounded-full" onClick={onCancel} />
        ) : (
          <IconButton icon={Trash2} label={`${row.title || '미션'} 삭제`} size="sm" tooltip={false} className="!size-7 !rounded-full" onClick={onDelete} />
        )}
      </span>
    </li>
  );
}

/** 맡긴 일 목록: 검색과 행. 어떤 표면 위에 놓일지는 부모가 정한다. */
export default function MissionList({
  onPick,
  onCancel,
  onDelete,
  autoFocusSearch,
}: {
  /** 행을 고른 뒤 할 일 (시트 닫기 등) */
  onPick?: () => void;
  onCancel: (id: string) => void;
  onDelete: (row: MissionRow) => void;
  autoFocusSearch?: boolean;
}) {
  const rows = useMissionRows();
  const { focusedId, focus } = useMissions();
  const now = useNow();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.title} ${r.goal}`.toLowerCase().includes(q));
  }, [rows, query]);

  if (rows.length === 0) {
    return <p className="px-1 py-2 text-subhead text-label-2">아직 맡긴 일이 없어요. 아래 입력창에 적으면 여기에 쌓여요.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TextField
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="미션 찾기"
        aria-label="미션 찾기"
        autoFocus={autoFocusSearch}
        leading={<Search size={15} aria-hidden="true" />}
        wrapperClassName="shrink-0"
      />
      {filtered.length === 0 ? (
        <EmptyState compact icon={Search} title="찾는 미션이 없어요" description="다른 단어로 찾아보세요." />
      ) : (
        <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {filtered.map((row) => (
            <Row
              key={row.id}
              row={row}
              now={now}
              selected={row.id === focusedId}
              onSelect={() => {
                focus(row.id);
                onPick?.();
              }}
              onCancel={() => onCancel(row.id)}
              onDelete={() => onDelete(row)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
