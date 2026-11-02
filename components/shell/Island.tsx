'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, CircleAlert, RotateCcw, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { openApprovalDetails } from '@/components/mission/selection';
import { TAINT_WARNING, turnStart, visibleReason } from '@/components/mission/status';
import { useApprovalArmed } from '@/components/mission/useApprovalArmed';
import { AGENTS, BRAND, type AgentId, type ApprovalDecision, type MissionView } from '@/lib/contracts';
import { AgentAvatar, Badge, Button, IconButton, LiquidGlass, spring, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';
import { formatClock, formatCost, formatElapsed } from '@/lib/client/format';
import { isActive } from '@/lib/missions/reducer';
import { useNow } from '@/utils/useNow';
import BrandMark from './BrandMark';

const DONE_WINDOW_MS = 6000;
const FAILED_WINDOW_MS = 30000;

const fade = {
  initial: { opacity: 0, filter: 'blur(4px)' },
  animate: { opacity: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, filter: 'blur(4px)' },
  transition: { duration: 0.18 },
};

function missionActivity(m: MissionView): string {
  if (m.status === 'planning') return '계획을 세우고 있어요';
  if (m.status === 'awaiting_plan') return '계획 승인을 기다려요';
  if (m.status === 'synthesizing') return '결과를 합치고 있어요';
  const running = m.stepOrder.map((id) => m.steps[id]).filter((s) => s?.status === 'running' || s?.status === 'awaiting_approval');
  const first = running[0];
  if (!first) return '다음 단계를 준비하고 있어요';
  return first.activity || `${AGENTS[first.step.agent].name}: ${first.step.title}`;
}

function activeAgents(m: MissionView): AgentId[] {
  if (m.status === 'planning' || m.status === 'synthesizing') return [];
  const set = new Set<AgentId>();
  for (const id of m.stepOrder) {
    const s = m.steps[id];
    if (s?.status === 'running' || s?.status === 'awaiting_approval') set.add(s.step.agent);
  }
  return Array.from(set).slice(0, 4);
}

function stepProgress(m: MissionView) {
  const total = m.stepOrder.length;
  const done = m.stepOrder.filter((id) => ['done', 'failed', 'skipped', 'cancelled'].includes(m.steps[id]?.status)).length;
  return { total, done };
}

export default function Island() {
  const { missions, activeIds, pendingApprovals, focusedId, focus, start, decide } = useMissions();
  const { bootstrap, navigate, setPaletteOpen, settings, view } = useApp();
  const toast = useToast();
  const now = useNow();

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [minimizedId, setMinimizedId] = useState<string | null>(null);
  const [carousel, setCarousel] = useState(0);
  const [deciding, setDeciding] = useState<string | null>(null);

  const running = useMemo(() => activeIds.map((id) => missions[id]).filter(Boolean), [activeIds, missions]);
  const current = running[Math.min(carousel, Math.max(running.length - 1, 0))];

  // 끝난 미션은 잠깐만 알린다. 실제 종료 시각에서 파생하므로 새로고침해도 다시 뜨지 않는다.
  const recent = useMemo(() => {
    if (!now) return null;
    let best: MissionView | null = null;
    for (const m of Object.values(missions)) {
      if (!m.finishedAt || isActive(m.status) || m.status === 'cancelled') continue;
      const age = now - m.finishedAt;
      const windowMs = m.status === 'failed' ? FAILED_WINDOW_MS : DONE_WINDOW_MS;
      if (age < 0 || age >= windowMs || dismissed.has(`${m.id}:${m.finishedAt}`)) continue;
      if (!best || (m.finishedAt ?? 0) > (best.finishedAt ?? 0)) best = m;
    }
    return best;
  }, [missions, now, dismissed]);

  const dismiss = (m: MissionView) => setDismissed((cur) => new Set(cur).add(`${m.id}:${m.finishedAt}`));

  const openMission = (id: string) => {
    focus(id);
    navigate('missions');
  };

  const onDecide = async (missionId: string, approvalId: string, decision: ApprovalDecision) => {
    setDeciding(approvalId);
    try {
      await decide(missionId, approvalId, decision);
    } catch (err) {
      toast({
        tone: 'danger',
        title: '결정을 전달하지 못했어요',
        description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setDeciding(null);
    }
  };

  const pending = pendingApprovals[0];
  // 그 미션을 보고 있으면 같은 카드가 화면에 이미 있다. 아일랜드는 작은 알림으로만 남는다.
  const shownInline = pending && view === 'missions' && pending.missionId === focusedId;
  const approvalExpanded = pending && pending.approval.id !== minimizedId && !shownInline;

  let key: string;
  let body: React.ReactNode;

  if (pending && approvalExpanded) {
    key = `approval:${pending.approval.id}`;
    body = (
      <ApprovalCard
        missionTitle={pending.missionTitle}
        approval={pending.approval}
        remaining={pendingApprovals.length}
        busy={deciding === pending.approval.id}
        onDecide={(d) => void onDecide(pending.missionId, pending.approval.id, d)}
        onDetails={() => {
          // 미션 화면의 미리보기 시트로 곧장 데려간다. 카드는 접어 시트와 겹치지 않게 한다.
          openApprovalDetails(pending.missionId, pending.approval.id);
          setMinimizedId(pending.approval.id);
          openMission(pending.missionId);
        }}
        onMinimize={() => setMinimizedId(pending.approval.id)}
      />
    );
  } else if (pending) {
    key = 'approval-min';
    body = (
      <button
        type="button"
        onClick={() =>
          shownInline
            ? openApprovalDetails(pending.missionId, pending.approval.id)
            : setMinimizedId(null)
        }
        className="flex h-11 max-w-[min(560px,calc(100vw-24px))] items-center gap-2.5 rounded-full pr-4 pl-3 text-callout outline-offset-[-3px]"
      >
        <ShieldAlert size={18} className="shrink-0 text-warning-text" aria-hidden="true" />
        <span className="shrink-0 font-semibold text-label">승인 대기 {pendingApprovals.length}건</span>
        <span className="min-w-0 truncate text-label-2">{pending.approval.summary}</span>
      </button>
    );
  } else if (recent?.status === 'failed') {
    const m = recent;
    key = `failed:${m.id}:${m.finishedAt}`;
    body = (
      <div className="flex h-11 max-w-[min(600px,calc(100vw-24px))] items-center gap-2 pr-1.5 pl-3">
        <CircleAlert size={18} className="shrink-0 text-danger-text" aria-hidden="true" />
        <button
          type="button"
          onClick={() => openMission(m.id)}
          className="min-w-0 truncate rounded-md text-left text-callout font-medium text-label"
        >
          {m.error?.message ?? '미션을 끝내지 못했어요'}
        </button>
        <Button
          size="sm"
          variant="secondary"
          icon={RotateCcw}
          className="!rounded-full"
          onClick={() => {
            dismiss(m);
            void start(m.goal).catch((err) =>
              toast({ tone: 'danger', title: '다시 시작하지 못했어요', description: err instanceof ClientApiError ? err.message : undefined })
            );
          }}
        >
          다시 시도
        </Button>
        <IconButton icon={X} label="알림 닫기" size="sm" tooltip={false} className="!rounded-full" onClick={() => dismiss(m)} />
      </div>
    );
  } else if (recent) {
    const m = recent;
    key = `done:${m.id}:${m.finishedAt}`;
    body = (
      <button
        type="button"
        onClick={() => {
          dismiss(m);
          openMission(m.id);
        }}
        className="flex h-11 max-w-[min(560px,calc(100vw-24px))] items-center gap-2.5 rounded-full pr-4 pl-2.5 text-callout outline-offset-[-3px]"
      >
        <motion.span
          initial={{ scale: 0.3 }}
          animate={{ scale: 1 }}
          transition={spring.snappy}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-white"
        >
          <Check size={16} strokeWidth={3} aria-hidden="true" />
        </motion.span>
        <span className="min-w-0 truncate font-medium text-label">{m.title}</span>
        <span className="shrink-0 font-semibold text-accent-text">결과 보기</span>
      </button>
    );
  } else if (current) {
    key = 'running';
    body = (
      <RunningPill
        mission={current}
        index={Math.min(carousel, running.length - 1)}
        count={running.length}
        now={now}
        onOpen={() => openMission(current.id)}
        onStep={(delta) => setCarousel((Math.min(carousel, running.length - 1) + delta + running.length) % running.length)}
      />
    );
  } else {
    key = 'idle';
    body = (
      <div className="flex h-11 items-center">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label={`${BRAND.name}, 명령 찾기 열기`}
          className="flex h-11 items-center gap-2 rounded-full pr-4 pl-3 text-callout outline-offset-[-3px]"
        >
          <BrandMark size={20} className="text-accent" />
          <span className="font-semibold text-label">{settings.displayName ? `${settings.displayName}님` : BRAND.name}</span>
          <span className="min-w-[2.6rem] text-label-2">{now ? formatClock(now) : ''}</span>
        </button>
        {bootstrap?.mode === 'demo' && (
          <button
            type="button"
            onClick={() => navigate('settings')}
            className="mr-2 -ml-1.5 rounded-full"
            aria-label="데모 모드입니다. 설정에서 API 키를 연결할 수 있어요"
          >
            <Badge tone="neutral">데모 모드</Badge>
          </button>
        )}
      </div>
    );
  }

  const announcement = pending
    ? `승인이 필요해요: ${pending.approval.summary}`
    : recent?.status === 'failed'
      ? `미션 실패: ${recent.title}`
      : recent
        ? `미션 완료: ${recent.title}`
        : '';

  return (
    <div className="island-anchor">
      <span className="sr-only-live" role="status" aria-live={pending ? 'assertive' : 'polite'}>
        {announcement}
      </span>
      <MorphingGlass contentKey={key} expanded={Boolean(pending && approvalExpanded)}>
        {body}
      </MorphingGlass>
    </div>
  );
}

/** 안쪽 콘텐츠 크기를 재서 유리 표면을 스프링으로 늘이고 줄인다. */
function MorphingGlass({ contentKey, expanded, children }: { contentKey: string; expanded: boolean; children: React.ReactNode }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 168, height: 44 });

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = Math.ceil(el.offsetWidth);
      const height = Math.ceil(el.offsetHeight);
      if (width > 0 && height > 0) {
        setSize((cur) => (cur.width === width && cur.height === height ? cur : { width, height }));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className="pointer-events-auto"
      initial={false}
      animate={{ width: size.width, height: size.height }}
      transition={spring.morph}
      style={{ maxWidth: '100%' }}
    >
      {/* 펼친 카드는 승인 내용을 읽는 화면이다. 가장자리로 뒤쪽 글자가 비치지 않도록 굴절을 끈다. */}
      <LiquidGlass
        refract={!expanded}
        radius={expanded ? 28 : 22}
        tint={expanded ? 'thick' : 'default'}
        bezel={expanded ? 16 : 12}
        strength={34}
        interactive={!expanded}
        pressable={!expanded}
        className="h-full w-full"
        style={{ transition: 'border-radius .3s var(--ease-standard)' }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[inherit]">
          <div ref={measureRef} className="absolute top-0 left-1/2 w-max max-w-[calc(100vw-24px)] -translate-x-1/2">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={contentKey} {...fade}>
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </LiquidGlass>
    </motion.div>
  );
}

function RunningPill({
  mission,
  index,
  count,
  now,
  onOpen,
  onStep,
}: {
  mission: MissionView;
  index: number;
  count: number;
  now: number;
  onOpen: () => void;
  onStep: (delta: number) => void;
}) {
  const agents = activeAgents(mission);
  const { total, done } = stepProgress(mission);
  const activity = missionActivity(mission);
  return (
    <div className="relative flex h-11 max-w-[min(640px,calc(100vw-24px))] items-center">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${mission.title} 미션 열기. ${activity}`}
        className="flex h-11 min-w-0 items-center gap-2.5 rounded-full pr-3 pl-2 text-callout outline-offset-[-3px]"
      >
        {/* 지휘자에서 갈라져 나온 방울이 지금 일하는 에이전트다 */}
        <span className="flex shrink-0 items-center">
          <AgentAvatar agent="conductor" size={28} decorative working status={agents.length === 0 ? 'running' : undefined} />
          <AnimatePresence initial={false}>
            {agents.map((agent, i) => (
              <motion.span
                key={agent}
                layout
                initial={{ x: -18, scale: 0.3, opacity: 0 }}
                animate={{ x: 0, scale: 1, opacity: 1 }}
                exit={{ x: -18, scale: 0.3, opacity: 0 }}
                transition={spring.morph}
                className="-ml-1.5 flex"
                style={{ zIndex: 4 - i }}
              >
                <AgentAvatar agent={agent} size={24} decorative working />
              </motion.span>
            ))}
          </AnimatePresence>
        </span>
        {/* 활동 문구가 바뀔 때마다 필의 폭이 출렁이지 않도록 폭을 고정한다. */}
        <span className="w-[clamp(110px,22vw,280px)] min-w-0 truncate font-medium text-label">{activity}</span>
        <span className="flex shrink-0 items-center gap-2 text-subhead text-label-2">
          {total > 0 && (
            <span>
              {done}/{total}
            </span>
          )}
          {now > 0 && <span>{formatElapsed(Math.max(now - turnStart(mission), 0))}</span>}
          {mission.mode === 'live' && mission.usage.costUsd > 0 && <span>{formatCost(mission.usage.costUsd)}</span>}
          {mission.mode === 'demo' && <Badge tone="neutral">데모</Badge>}
        </span>
      </button>
      {count > 1 && (
        <span className="mr-1.5 flex shrink-0 items-center">
          <IconButton icon={ChevronLeft} label="이전 미션" size="sm" tooltip={false} className="!size-7 !rounded-full" onClick={() => onStep(-1)} />
          <span className="text-footnote text-label-2" aria-live="polite">
            {index + 1}/{count}
          </span>
          <IconButton icon={ChevronRight} label="다음 미션" size="sm" tooltip={false} className="!size-7 !rounded-full" onClick={() => onStep(1)} />
        </span>
      )}
      {total > 0 && (
        <span className="pointer-events-none absolute inset-x-5 bottom-0 h-[2px] overflow-hidden rounded-full" aria-hidden="true">
          <motion.span
            className="block h-full rounded-full bg-accent"
            initial={false}
            animate={{ width: `${(done / total) * 100}%` }}
            transition={spring.gentle}
          />
        </span>
      )}
    </div>
  );
}

function ApprovalCard({
  missionTitle,
  approval,
  remaining,
  busy,
  onDecide,
  onDetails,
  onMinimize,
}: {
  missionTitle: string;
  approval: NonNullable<ReturnType<typeof useMissions>['pendingApprovals'][number]>['approval'];
  remaining: number;
  busy: boolean;
  onDecide: (decision: ApprovalDecision) => void;
  onDetails: () => void;
  onMinimize: () => void;
}) {
  const armed = useApprovalArmed(approval.id);
  const danger = approval.risk === 'danger';
  const agent = AGENTS[approval.agent];
  const reason = visibleReason(approval);
  return (
    <div
      role="alertdialog"
      data-approval-ui=""
      aria-labelledby="island-approval-title"
      aria-describedby="island-approval-summary"
      className="w-[min(460px,calc(100vw-24px))] p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onMinimize();
        }
      }}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={approval.agent} size={30} decorative working />
        <div className="min-w-0 flex-1">
          <h2 id="island-approval-title" className="truncate text-callout font-semibold text-label">
            {agent.name}의 작업을 승인할까요?
          </h2>
          <p className="truncate text-footnote text-label-2">{missionTitle}</p>
        </div>
        {remaining > 1 && <Badge>외 {remaining - 1}건</Badge>}
        <Badge tone={danger ? 'danger' : 'warning'} className={danger ? undefined : 'approval-pill'}>{danger ? '위험' : '변경'}</Badge>
        <IconButton icon={X} label="나중에 보기" size="sm" tooltip={false} className="-mr-1 !size-7 !rounded-full" onClick={onMinimize} />
      </div>

      <p id="island-approval-summary" className="mt-3 text-body font-medium text-label">
        {approval.summary}
      </p>
      {reason && <p className="mt-1 text-subhead text-label-2">{reason}</p>}

      {approval.tainted && (
        <p className="mt-2.5 flex items-start gap-2 rounded-[12px] bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] px-3 py-2 text-subhead text-warning-text">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{TAINT_WARNING}</span>
        </p>
      )}

      {/* 기본 포커스를 주지 않는다. 다른 곳에서 치던 Enter가 승인으로 이어지면 안 된다. */}
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="plain" onClick={onDetails}>
          자세히
        </Button>
        <span className="flex-1" />
        <Button size="md" variant="secondary" disabled={busy} className="!rounded-full" onClick={() => onDecide('deny')}>
          거부
        </Button>
        <Button
          size="md"
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          disabled={!armed}
          className="!rounded-full"
          onClick={() => onDecide('approve')}
        >
          승인
        </Button>
      </div>
    </div>
  );
}
