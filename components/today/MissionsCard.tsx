'use client';

import { useMemo } from 'react';
import { CircleCheck, CircleX, Sparkles } from 'lucide-react';
import { AGENTS, type MissionSummary, type MissionView } from '@/lib/contracts';
import { AgentAvatar, Badge, Material, ProgressBar } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { formatRelative } from '@/lib/client/format';

function useOpenMission() {
  const { navigate } = useApp();
  const { focus } = useMissions();
  return (id: string) => {
    focus(id);
    navigate('missions');
  };
}

function statusLine(mission: MissionView): string {
  const steps = Object.values(mission.steps);
  const working = steps.find((s) => s.status === 'running' && s.activity) ?? steps.find((s) => s.status === 'running');
  if (working) return `${AGENTS[working.step.agent].name}: ${working.activity || working.step.title}`;
  if (mission.status === 'planning') return '지휘자가 계획을 세우고 있어요';
  if (mission.status === 'awaiting_plan') return '계획을 확인해 주세요';
  if (mission.status === 'awaiting_approval') return '승인을 기다리고 있어요';
  if (mission.status === 'synthesizing') return '결과를 하나로 합치고 있어요';
  return '진행 중이에요';
}

function ActiveMission({ mission }: { mission: MissionView }) {
  const open = useOpenMission();
  const steps = Object.values(mission.steps);
  const done = steps.filter((s) => s.status === 'done').length;
  const running = steps.filter((s) => s.status === 'running' || s.status === 'awaiting_approval');
  const isPlanning = steps.length === 0;
  return (
    <button
      type="button"
      onClick={() => open(mission.id)}
      className="press flex w-full items-center gap-3 rounded-[14px] p-2.5 text-left hover:bg-fill-4"
    >
      <span className="flex shrink-0 -space-x-2" aria-hidden="true">
        {isPlanning ? (
          <AgentAvatar agent="conductor" size="sm" status="running" decorative />
        ) : (
          running.slice(0, 3).map((s) => <AgentAvatar key={s.step.id} agent={s.step.agent} size="sm" status={s.status} decorative />)
        )}
        {!isPlanning && running.length === 0 && <AgentAvatar agent="conductor" size="sm" status="running" decorative />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-callout font-semibold text-label">{mission.title}</span>
        <span className="block truncate text-subhead text-label-2">{statusLine(mission)}</span>
      </span>
      {steps.length > 0 && (
        <span className="flex w-20 shrink-0 flex-col items-end gap-1 max-[420px]:w-14">
          <span className="text-footnote text-label-2 tabular-nums">
            {done}/{steps.length}
          </span>
          <ProgressBar value={done / steps.length} label={`${mission.title} 진행률`} height={4} className="w-full" />
        </span>
      )}
    </button>
  );
}

/** 진행 중인 미션. 승인 요청은 아일랜드가 묻고, 여기서는 미션 줄에 상태로 보인다. 없으면 아무것도 그리지 않는다. */
export function ActiveMissionsCard({ className }: { className?: string }) {
  const { activeIds, missions } = useMissions();
  const active = useMemo(() => activeIds.map((id) => missions[id]).filter(Boolean), [activeIds, missions]);
  if (active.length === 0) return null;

  return (
    <Material as="section" aria-labelledby="today-missions" className={`p-4 ${className ?? ''}`}>
      <h2 id="today-missions" className="mb-1.5 px-1 text-headline text-label">
        진행 중인 미션
      </h2>
      <ul>
        {active.map((mission) => (
          <li key={mission.id}>
            <ActiveMission mission={mission} />
          </li>
        ))}
      </ul>
    </Material>
  );
}

function RecentRow({ summary, now }: { summary: MissionSummary; now: number }) {
  const open = useOpenMission();
  const failed = summary.status !== 'done';
  const Icon = failed ? CircleX : CircleCheck;
  return (
    <button
      type="button"
      onClick={() => open(summary.id)}
      className="press flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left hover:bg-fill-4"
    >
      <Icon size={16} className={`shrink-0 ${failed ? 'text-label-2' : 'text-success-text'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-callout text-label">{summary.title}</span>
      {summary.status === 'cancelled' && <Badge>취소됨</Badge>}
      {summary.status === 'failed' && <Badge tone="danger">실패</Badge>}
      {now > 0 && <span className="shrink-0 text-footnote text-label-2">{formatRelative(summary.finishedAt ?? summary.updatedAt, now)}</span>}
    </button>
  );
}

/** 돌아왔을 때 어디까지 됐는지 이어서 볼 수 있게 끝난 미션 몇 개를 고른다. */
export function useRecentMissions(): MissionSummary[] {
  const { summaries, activeIds } = useMissions();
  return useMemo(
    () => summaries.filter((s) => !activeIds.includes(s.id) && (s.status === 'done' || s.status === 'failed' || s.status === 'cancelled')).slice(0, 3),
    [summaries, activeIds]
  );
}

export function RecentMissions({ recent, now, className }: { recent: MissionSummary[]; now: number; className?: string }) {
  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="today-recent" className={className}>
      <h2 id="today-recent" className="mb-1 flex items-center gap-1.5 px-2 pt-0.5 text-subhead font-semibold text-label-2">
        <Sparkles size={13} aria-hidden="true" />
        최근 미션
      </h2>
      <ul>
        {recent.map((s) => (
          <li key={s.id}>
            <RecentRow summary={s} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
