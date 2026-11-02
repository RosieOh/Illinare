'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { History, Plus, Square, Trash2 } from 'lucide-react';
import type { ApprovalRequest, MissionView } from '@/lib/contracts';
import { Badge, Button, LiquidGlass, Material, Sheet, Skeleton, spring, useToast } from '@/components/glass';
import { useRegisterCommands, type Command } from '@/components/shell/commands';
import { ViewFixed, type ViewProps } from '@/components/shell/ViewFrame';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';
import { formatCost, formatElapsed } from '@/lib/client/format';
import { isActive } from '@/lib/missions/reducer';
import { useMediaQuery } from '@/utils/useMediaQuery';
import { useNow } from '@/utils/useNow';
import AnswerSurface, { FailureNote } from '@/components/mission/AnswerPanel';
import { ApprovalFloat, ApprovalSheet } from '@/components/mission/Approval';
import { ANSWER_NODE, approvalAnchor, CONDUCTOR_NODE, type StageLayout } from '@/components/mission/layout';
import MissionList, { useMissionRows, type MissionRow } from '@/components/mission/MissionList';
import { clearSelection, openApprovalDetails, selectStep, useMissionSelection } from '@/components/mission/selection';
import Stage from '@/components/mission/Stage';
import { effectiveMissionStatus, MISSION_STATUS_LABEL, missionTone, turnStart } from '@/components/mission/status';
import { ConductorDetail, StepDetailBody, StepHeader } from '@/components/mission/StepDetail';
import TeamDroplets from '@/components/mission/TeamDroplets';
import { useElementSize } from '@/components/mission/useElementSize';

const STARTERS = [
  { goal: '경쟁 제품 가격을 조사해서 보고서로 써줘', hint: '웹 조사, 계산, 문서 작성을 나눠서 해요' },
  { goal: '다운로드 폴더를 정리해줘', hint: '파일을 살펴보고, 지우기 전에 먼저 물어봐요' },
  { goal: '이번 주 계획을 세워줘', hint: '일정과 할 일을 읽고 집중 시간을 잡아요' },
];

const DEMO_NOTICE = '데모에서는 입력과 상관없이 준비된 예시를 재생해요.';
/** 물방울이 결과 구에 도착해 차오르는 모습을 본 뒤에 펼친다 */
const REVEAL_HOLD_MS = 1500;

/** 미션을 고르지 않았을 때: 팀과 시작 예시, 그리고 지난 미션 전체 목록 */
function Landing({ active, onCancel, onDelete }: { active: boolean; onCancel: (id: string) => void; onDelete: (row: MissionRow) => void }) {
  const { fillComposer, bootstrap } = useApp();
  const rows = useMissionRows();
  const wide = useMediaQuery('(min-width: 1000px)');
  const hasMissions = rows.length > 0;
  return (
    <div className="flex min-h-0 flex-1 gap-6 overflow-y-auto max-lg:flex-col max-lg:overflow-y-auto lg:items-stretch">
      <div className={`flex min-w-0 flex-col justify-center ${hasMissions ? 'lg:flex-[1.15] lg:px-[max(0px,calc((100%-640px)/2))]' : 'mx-auto w-full max-w-[620px] flex-1'}`}>
        <TeamDroplets size={wide ? 208 : 136} decorative active={active} className="mb-5" />
        <h1 className="text-large-title text-label max-sm:text-title1">팀에게 일을 맡겨 보세요</h1>
        <p className="mt-2 max-w-[60ch] text-body text-label-2">
          목표를 적으면 지휘자가 일을 나누고, 전문 에이전트들이 동시에 처리해요. 바꾸는 일은 실행 전에 먼저 물어봐요.
        </p>
        <ul className="mt-5 max-w-[620px] space-y-1.5">
          {STARTERS.map((starter) => (
            <li key={starter.goal}>
              <button
                type="button"
                onClick={() => fillComposer(starter.goal)}
                className="material press w-full !rounded-[16px] px-4 py-3 text-left hover:brightness-[1.03]"
              >
                <span className="block text-callout font-semibold text-label">{starter.goal}</span>
                <span className="mt-0.5 block text-subhead text-label-2">{starter.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        {bootstrap?.mode === 'demo' && <p className="mt-4 max-w-[60ch] text-subhead text-label-2">지금은 데모 모드예요. {DEMO_NOTICE} 파일이나 설정은 건드리지 않아요.</p>}
      </div>
      {hasMissions && (
        <Material tier="thin" radius={24} className="flex min-h-[320px] min-w-0 flex-col p-3 lg:w-[400px] lg:shrink-0" aria-label="지난 미션">
          <h2 className="mb-2 px-1 text-headline text-label">지난 미션</h2>
          <MissionList onCancel={onCancel} onDelete={onDelete} />
        </Material>
      )}
    </div>
  );
}

/**
 * 기록, 삭제, (필요할 때) 멈추기를 한 덩어리로. 칼럼이 스크롤되어도 위에 붙어 있다:
 * 좁은 화면에서 컴포저가 접히면 여기가 유일한 멈추기라 스크롤로 사라지면 안 된다.
 */
function MissionTools({
  running,
  showStop,
  onHistory,
  onCancel,
  onDelete,
}: {
  running: boolean;
  /** 멈추기는 컴포저에 있다. 좁은 화면에서 컴포저가 접혀 있을 때만 여기 둔다 */
  showStop: boolean;
  onHistory: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mission-tools-dock">
      <LiquidGlass radius={20} className="mission-tools">
        <button type="button" onClick={onHistory} aria-label="미션 기록 열기" className="mission-tool">
          <History size={16} aria-hidden="true" />
          <span className="max-sm:hidden">기록</span>
        </button>
        {running && showStop && (
          <button type="button" onClick={onCancel} className="mission-tool">
            <Square size={14} aria-hidden="true" />
            멈추기
          </button>
        )}
        {!running && (
          <button type="button" onClick={onDelete} aria-label="미션 삭제" title="미션 삭제" className="mission-tool">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </LiquidGlass>
    </div>
  );
}

function MissionHeader({ view, reading, headerRef }: { view: MissionView; reading: boolean; headerRef: Ref<HTMLElement> }) {
  const now = useNow();
  const status = effectiveMissionStatus(view);
  const running = isActive(view.status);
  const elapsed = (view.finishedAt ?? now) - turnStart(view);
  const reduce = useReducedMotion();
  return (
    <motion.header
      ref={headerRef}
      layout={reduce ? false : 'position'}
      layoutDependency={reading}
      transition={{ layout: spring.gentle }}
      className="mission-header flex shrink-0 items-start gap-3 pb-1"
    >
      <div className="min-w-0 flex-1">
        <h1 className={`truncate text-label ${reading ? 'text-title2' : 'text-large-title max-sm:text-title1'}`}>{view.title || view.goal}</h1>
        {view.title && view.title !== view.goal && !reading && <p className="mt-0.5 line-clamp-2 max-w-[70ch] text-callout text-label-2">{view.goal}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-subhead text-label-2">
          <Badge tone={missionTone(status)} dot className={missionTone(status) === 'warning' ? 'approval-pill' : undefined}>
            {MISSION_STATUS_LABEL[status]}
          </Badge>
          {(view.finishedAt || now > 0) && (
            <span>
              {running ? '경과' : '걸린 시간'} {formatElapsed(Math.max(elapsed, 0))}
            </span>
          )}
          {view.mode === 'live' && view.usage.costUsd > 0 && <span>{formatCost(view.usage.costUsd)}</span>}
          {/* 끝나면 답변 맨 끝의 안내가 같은 말을 한다. 복사해도 함께 따라가는 쪽을 남긴다 */}
          {view.mode === 'demo' && view.status !== 'done' && <span>{DEMO_NOTICE}</span>}
        </div>
      </div>
    </motion.header>
  );
}

function MissionMain({
  view,
  active,
  onHistory,
  onCancel,
  onDelete,
}: {
  view: MissionView;
  active: boolean;
  onHistory: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const selection = useMissionSelection();
  const narrow = useMediaQuery('(max-width: 819px)');
  const [columnRef, column] = useElementSize<HTMLDivElement>();
  const [headerRef, header] = useElementSize<HTMLElement>();

  // ── 읽는 모드: 답변이 시작되면 결과 구가 표면으로 펼쳐지고 스테이지는 띠가 된다 ──
  const turnKey = `${view.id}:${view.turns.length}`;
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const answerStarted = view.answer.length > 0;
  useEffect(() => {
    if (!answerStarted) return;
    const timer = setTimeout(() => setRevealedKey(turnKey), REVEAL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [answerStarted, turnKey]);

  const finishedWithAnswer = view.status === 'done' && answerStarted;
  const partial = view.status === 'failed' && view.stepOrder.some((id) => view.steps[id]?.output);
  const reading = revealedKey === turnKey || finishedWithAnswer || partial || view.turns.length > 0;

  const morphId = `mission-result-${view.id}`;
  const selectedId = selection.missionId === view.id ? selection.stepId : null;
  const selectedStep = selectedId && selectedId !== CONDUCTOR_NODE ? view.steps[selectedId] : undefined;
  const showConductor = selectedId === CONDUCTOR_NODE;
  const closeDetail = useCallback(() => selectStep(view.id, null), [view.id]);

  const onSelectNode = (nodeId: string) => {
    if (nodeId === ANSWER_NODE) selectStep(view.id, null);
    else selectStep(view.id, nodeId);
  };

  const approval =
    active && selection.missionId === view.id && selection.approvalId ? (view.approvals.find((a) => a.id === selection.approvalId) ?? null) : null;

  // 시트는 inert 영역 밖으로 포털되므로, 다른 화면으로 가면 직접 닫아야 한다.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) clearSelection();
    wasActive.current = active;
  }, [active]);

  const detail = selectedStep ? (
    <>
      <StepHeader step={selectedStep} onClose={closeDetail} />
      <div className="mt-3">
        <StepDetailBody view={view} step={selectedStep} />
      </div>
    </>
  ) : showConductor ? (
    <ConductorDetail view={view} onClose={closeDetail} />
  ) : null;

  const pending: ApprovalRequest | undefined = view.approvals[0];
  const docked = narrow || reading;

  // 좁은 화면: 승인 카드가 떠 있는 동안 컴포저를 접어 거부와 승인이 늘 보이게 한다.
  const collapseComposer = active && narrow && Boolean(pending);
  useEffect(() => {
    if (!collapseComposer) return;
    document.documentElement.setAttribute('data-mission-approval', '');
    return () => document.documentElement.removeAttribute('data-mission-approval');
  }, [collapseComposer]);

  // 좁은 화면: 카드가 스테이지 아래쪽을 덮으므로, 무엇을 묻는지 보이게 기다리는 구를 카드 위로 끌어올린다.
  const waitingStep = pending?.stepId;
  useEffect(() => {
    if (!active || !narrow || !waitingStep) return;
    const orb = Array.from(document.querySelectorAll<HTMLElement>('.view-slot[data-active] .stage [data-pool-id]')).find((el) => el.dataset.poolId === waitingStep);
    orb?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [active, narrow, waitingStep]);

  const renderOverlay = (layout: StageLayout) => {
    if (!pending || docked) return null;
    const target = layout.nodes.find((n) => n.id === pending.stepId) ?? layout.nodes.find((n) => n.id === CONDUCTOR_NODE);
    if (!target) return null;
    const anchor = approvalAnchor(target, layout);
    return (
      <ApprovalFloat
        missionId={view.id}
        approval={pending}
        more={view.approvals.length - 1}
        onDetails={() => openApprovalDetails(view.id, pending.id)}
        className="approval-float"
        style={
          anchor.placement === 'above'
            ? { left: anchor.x, bottom: anchor.bottom, width: anchor.width, maxHeight: anchor.maxHeight }
            : { left: anchor.x, top: anchor.y, width: anchor.width, maxHeight: anchor.maxHeight }
        }
      />
    );
  };

  // 히어로에서 스테이지가 쓸 수 있는 높이: 칼럼에서 머리글을 뺀 만큼. 머리글은 줄바꿈에 따라 달라지므로 실제로 잰다.
  const stageMax = Math.max(240, column.height - header.height);
  const failedOnly = !reading && (view.status === 'failed' || view.status === 'cancelled');

  return (
    <div ref={columnRef} className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${narrow ? 'overflow-x-hidden overflow-y-auto' : reading ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto'}`}>
      <MissionTools running={isActive(view.status)} showStop={collapseComposer} onHistory={onHistory} onCancel={onCancel} onDelete={onDelete} />
      {/* 읽는 동안에는 제목, 띠, 표면이 한 칸에 모여 같은 왼쪽 선을 쓴다. 요소를 바꾸지 않아 스테이지가 다시 마운트되지 않는다 */}
      <div className={reading ? 'mission-reading' : 'contents'}>
        <MissionHeader view={view} reading={reading} headerRef={headerRef} />
        <Stage
          view={view}
          active={active}
          band={reading}
          maxHeight={stageMax}
          selectedId={selectedId}
          onSelect={onSelectNode}
          renderOverlay={renderOverlay}
          morphId={morphId}
        />

        {reading && <AnswerSurface view={view} morphId={morphId} scrollInside={!narrow} />}

        {/* 읽는 칸에서는 카드도 칸의 한 줄이다. 표면이 그만큼 줄어들 뿐 글자를 덮지 않아 끝까지 스크롤된다 */}
        {pending && reading && !narrow && (
          <ApprovalFloat
            missionId={view.id}
            approval={pending}
            more={view.approvals.length - 1}
            onDetails={() => openApprovalDetails(view.id, pending.id)}
            className="reading-approval"
          />
        )}
      </div>

      {/* 좁은 화면: 아래에 떠 있는 승인 카드에 가려진 구까지 스크롤해 볼 수 있게 자리를 둔다 */}
      {narrow && pending && <div className="h-[240px] shrink-0" aria-hidden="true" />}

      {failedOnly && (
        <LiquidGlass tint="thick" radius={24} className="mission-dock">
          <div className="p-4">
            {view.status === 'failed' ? (
              <FailureNote view={view} />
            ) : (
              <p className="text-callout font-medium text-label" role="status">
                미션을 멈췄어요. 끝난 단계는 구를 눌러 볼 수 있어요.
              </p>
            )}
          </div>
        </LiquidGlass>
      )}

      {pending && narrow && (
        <ApprovalFloat
          missionId={view.id}
          approval={pending}
          more={view.approvals.length - 1}
          onDetails={() => openApprovalDetails(view.id, pending.id)}
          className="mission-dock"
        />
      )}

      <Sheet open={Boolean(detail) && !approval && active} onClose={closeDetail} variant="side" width={460} ariaLabel="단계 상세" showClose={false}>
        <div className="pt-4">{detail}</div>
      </Sheet>
      <ApprovalSheet missionId={view.id} approval={approval} plan={view.plan} />
    </div>
  );
}

export default function MissionsView({ active }: ViewProps) {
  const { missions, focusedId, activeIds, focus, cancel, remove } = useMissions();
  const { focusComposer, navigate } = useApp();
  const toast = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pick<MissionRow, 'id' | 'title' | 'goal'> | null>(null);
  const [deleting, setDeleting] = useState(false);
  // "새 미션"을 눌렀을 때만 진행 중인 미션이 있어도 시작 화면을 보여 준다.
  const [wantsLanding, setWantsLanding] = useState(false);

  const focused = focusedId ? missions[focusedId] : undefined;

  // 팀이 일하는 중이면 빈 시작 화면 대신 그 미션을 보여 준다.
  const nextActive = activeIds[0];
  useEffect(() => {
    if (active && !focusedId && !wantsLanding && nextActive) focus(nextActive);
  }, [active, focusedId, wantsLanding, nextActive, focus]);

  // 시트는 inert 영역 밖으로 포털된다. 다른 화면으로 가면 닫는다.
  if (!active && historyOpen) setHistoryOpen(false);
  if (!active && deleteTarget) setDeleteTarget(null);
  if (!active && wantsLanding) setWantsLanding(false);

  const startNew = useCallback(() => {
    setWantsLanding(true);
    focus(null);
    navigate('missions');
    focusComposer();
  }, [focus, navigate, focusComposer]);

  const cancelMission = useCallback(
    (id: string) =>
      void cancel(id).catch((err) =>
        toast({ tone: 'danger', title: '미션을 멈추지 못했어요', description: err instanceof ClientApiError ? err.message : undefined })
      ),
    [cancel, toast]
  );

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      toast({ tone: 'danger', title: '삭제하지 못했어요', description: err instanceof ClientApiError ? err.message : undefined });
    } finally {
      setDeleting(false);
    }
  };

  const focusedActive = Boolean(focused && isActive(focused.status));
  const focusedIdForCommand = focused?.id;
  useRegisterCommands(
    useMemo<Command[]>(() => {
      const commands: Command[] = [{ id: 'mission-new', title: '새 미션', group: '미션', icon: Plus, keywords: ['맡기기', '시작'], run: startNew }];
      if (focusedActive && focusedIdForCommand) {
        commands.push({
          id: 'mission-cancel',
          title: '현재 미션 취소',
          group: '미션',
          icon: Square,
          keywords: ['멈추기', '중단'],
          run: () => cancelMission(focusedIdForCommand),
        });
      }
      return commands;
    }, [startNew, cancelMission, focusedActive, focusedIdForCommand])
  );

  const onDeleteRow = (row: MissionRow) => {
    setHistoryOpen(false);
    setDeleteTarget({ id: row.id, title: row.title, goal: row.goal });
  };

  return (
    <ViewFixed>
      {focused ? (
        <MissionMain
          key={focused.id}
          view={focused}
          active={active}
          onHistory={() => setHistoryOpen(true)}
          onCancel={() => cancelMission(focused.id)}
          onDelete={() => setDeleteTarget({ id: focused.id, title: focused.title, goal: focused.goal })}
        />
      ) : focusedId ? (
        <div className="flex flex-col gap-3 p-1" aria-busy="true">
          <Skeleton width="42%" height={34} />
          <Skeleton width="62%" />
          <Skeleton width="100%" height={260} className="mt-4" radius={24} />
        </div>
      ) : (
        <Landing active={active} onCancel={cancelMission} onDelete={onDeleteRow} />
      )}

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} variant="side" width={420} title="미션 기록">
        <div className="flex h-[min(70vh,640px)] flex-col">
          <Button size="sm" variant="secondary" icon={Plus} className="mb-3 self-start !rounded-full" onClick={() => { setHistoryOpen(false); startNew(); }}>
            새 미션
          </Button>
          <MissionList autoFocusSearch onPick={() => setHistoryOpen(false)} onCancel={cancelMission} onDelete={onDeleteRow} />
        </div>
      </Sheet>

      <Sheet
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="이 미션을 삭제할까요?"
        description={deleteTarget?.title || deleteTarget?.goal}
        width={420}
        footer={
          <>
            <Button variant="secondary" className="!rounded-full" onClick={() => setDeleteTarget(null)}>
              취소
            </Button>
            <Button variant="danger" loading={deleting} className="!rounded-full" onClick={() => void confirmDelete()}>
              삭제
            </Button>
          </>
        }
      >
        <p className="text-callout text-label-2">진행 기록과 결과가 지워져요. 파일이나 일정처럼 이미 만들어진 항목은 그대로 남아요.</p>
      </Sheet>
    </ViewFixed>
  );
}
