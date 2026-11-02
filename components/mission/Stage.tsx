'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, FileText, Hand, Minus, X, type LucideIcon } from 'lucide-react';
import { AGENTS, type AgentId, type MissionView, type PlanStep, type StepStatus } from '@/lib/contracts';
import { AGENT_ICONS, spring } from '@/components/glass';
import { CONDUCTOR_NODE, labelHeight, LABEL_GAP, layoutStage, type StageLayout, type StageNode } from './layout';
import { applyView, budFromConductor, emptyModel, syncLayout, type LiquidModel } from './liquid';
import LiquidLayer from './LiquidLayer';
import { Orb } from './Orb';
import { answerStatus, conductorStatus, stepCaption, STEP_STATUS_LABEL } from './status';
import { useElementSize } from './useElementSize';

const NO_STEPS: PlanStep[] = [];

const BADGE: Partial<Record<StepStatus, { icon: LucideIcon; tone: string }>> = {
  done: { icon: Check, tone: 'success' },
  failed: { icon: X, tone: 'danger' },
  awaiting_approval: { icon: Hand, tone: 'warning' },
  skipped: { icon: Minus, tone: 'neutral' },
  cancelled: { icon: Minus, tone: 'neutral' },
};

export interface StageProps {
  view: MissionView;
  /** 뷰가 보이는 동안만 움직인다 */
  active: boolean;
  /** 답변을 읽는 동안 낮은 띠로 줄어든다 */
  band: boolean;
  /** 히어로 모드에서 쓸 수 있는 높이 */
  maxHeight: number;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** 스테이지 좌표계 위에 띄울 것 (승인 카드 등) */
  renderOverlay?: (layout: StageLayout) => ReactNode;
  /** 결과 구가 답변 표면으로 펼쳐지는 공유 레이아웃 id */
  morphId?: string;
}

interface NodeInfo {
  status: StepStatus;
  title: string;
  caption: string;
  agent: AgentId | null;
}

function describeNode(node: StageNode, view: MissionView): NodeInfo {
  if (node.kind === 'conductor') {
    const status = conductorStatus(view);
    const caption =
      view.status === 'planning'
        ? '계획을 세우고 있어요'
        : view.status === 'awaiting_plan'
          ? '계획 승인을 기다려요'
          : view.plan?.route === 'answer'
            ? '바로 답해요'
            : view.plan
              ? `${view.plan.steps.length}단계로 나눴어요`
              : '';
    return { status, title: AGENTS.conductor.name, caption, agent: 'conductor' };
  }
  if (node.kind === 'answer') {
    const status = answerStatus(view);
    const caption =
      status === 'running'
        ? '결과를 합치고 있어요'
        : status === 'done'
          ? '합쳤어요'
          : status === 'failed'
            ? '끝내지 못했어요'
            : status === 'cancelled'
              ? '멈췄어요'
              : '여기로 모여요';
    return { status, title: '결과', caption, agent: null };
  }
  const step = view.steps[node.id];
  return {
    status: step?.status ?? 'pending',
    title: step?.step.title ?? '',
    caption: stepCaption(view, node.id),
    agent: step?.step.agent ?? null,
  };
}

function nodeTint(node: StageNode, view: MissionView, status: StepStatus): string {
  if (status === 'failed') return 'var(--danger)';
  if (node.kind === 'answer') return status === 'done' ? 'var(--success)' : 'var(--accent)';
  if (node.kind === 'conductor') return `var(${AGENTS.conductor.colorVar})`;
  const agent = view.steps[node.id]?.step.agent;
  return agent ? `var(${AGENTS[agent].colorVar})` : 'var(--accent)';
}

export default function Stage({ view, active, band, maxHeight, selectedId, onSelect, renderOverlay, morphId }: StageProps) {
  const [measureRef, { width }] = useElementSize<HTMLDivElement>();
  const reduce = useReducedMotion();
  const model = useRef<LiquidModel>(emptyModel());

  const steps = view.plan?.steps ?? NO_STEPS;
  const layout = useMemo<StageLayout | null>(
    () => (width > 0 ? layoutStage({ steps, width, maxHeight, mode: band ? 'band' : 'hero' }) : null),
    [steps, width, maxHeight, band]
  );

  // ── 데이터 → 액체 모델 ────────────────────────────────────
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const motionOk = active && visible && !reduce;

  const previous = useRef<MissionView | null>(null);
  const laidOut = useRef<StageLayout | null>(null);
  const latest = useRef(view);
  const signature = useMemo(() => {
    const parts = view.stepOrder.map((id) => `${id}:${view.steps[id]?.status}:${view.steps[id]?.toolCalls.length}`);
    return `${view.id}|${view.status}|${view.turns.length}|${parts.join(',')}`;
  }, [view]);
  const version = `${signature}|${layout?.width}|${layout?.height}|${layout?.density}|${motionOk}`;

  useLayoutEffect(() => {
    latest.current = view;
  });

  // 레이아웃 효과에서 모델을 맞춘다. 자식(LiquidLayer)의 일반 효과보다 먼저 돌아야 첫 프레임부터 맞다.
  // signature가 같으면 액체에 영향이 없으므로 글자 스트림마다 다시 계산하지 않는다.
  useLayoutEffect(() => {
    if (!layout) return;
    const now = performance.now();
    const current = latest.current;
    const hadLayout = laidOut.current !== null && previous.current?.id === current.id;
    if (laidOut.current !== layout) {
      syncLayout(model.current, layout, current, now, hadLayout && !reduce);
      laidOut.current = layout;
    }
    applyView(model.current, current, previous.current, now, Boolean(motionOk));
    previous.current = current;
  }, [layout, signature, motionOk, reduce]);

  // 계획을 세우는 동안 지휘자에 방울이 맺혔다 스러진다.
  const planning = view.status === 'planning';
  useEffect(() => {
    if (!planning || !motionOk) return;
    const bud = () => budFromConductor(model.current, performance.now());
    const start = setTimeout(bud, 300);
    const timer = setInterval(bud, 1700);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [planning, motionOk]);

  return (
    <motion.div
      ref={measureRef}
      layout={reduce ? false : 'position'}
      layoutDependency={band}
      transition={{ layout: spring.gentle }}
      className={`stage-scroll ${band ? 'shrink-0' : 'min-h-0 flex-1'}`}
      data-fits={layout && layout.width <= width ? '' : undefined}
      style={band ? { height: layout?.height ?? 82 } : layout ? { minHeight: layout.height } : undefined}
      role="group"
      aria-label="에이전트 팀 진행 상황"
    >
      {layout && (
        <div
          className="stage"
          data-paused={active ? undefined : ''}
          data-density={layout.density}
          data-orientation={layout.orientation}
          style={{ width: layout.width, height: layout.height }}
        >
          <LiquidLayer
            model={model}
            width={layout.width}
            height={layout.height}
            running={Boolean(motionOk)}
            frozen={Boolean(reduce)}
            version={version}
            blur={band ? 1.8 : 3.4}
          />
          {layout.nodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              density={layout.density}
              info={describeNode(node, view)}
              tint={nodeTint(node, view, describeNode(node, view).status)}
              selected={selectedId === node.id}
              reduce={Boolean(reduce)}
              onSelect={onSelect}
              morphId={node.kind === 'answer' && !band ? morphId : undefined}
              complete={node.kind === 'answer' && view.status === 'done'}
              quietCheck={band && node.kind !== 'answer'}
            />
          ))}
          {renderOverlay?.(layout)}
        </div>
      )}
    </motion.div>
  );
}

function NodeView({
  node,
  density,
  info,
  tint,
  selected,
  reduce,
  onSelect,
  morphId,
  complete,
  quietCheck,
}: {
  node: StageNode;
  density: StageLayout['density'];
  info: NodeInfo;
  tint: string;
  selected: boolean;
  reduce: boolean;
  onSelect: (nodeId: string) => void;
  morphId?: string;
  /** 모두 합쳐진 결과 구: 한 번 부풀며 끝을 알린다 */
  complete: boolean;
  /** 띠에서는 끝난 단계마다 체크를 달지 않는다. 결과 구의 체크 하나로 충분하다 */
  quietCheck: boolean;
}) {
  const badge = BADGE[info.status];
  const showBadge = badge && node.id !== CONDUCTOR_NODE && !(quietCheck && info.status === 'done');
  const Icon = info.agent ? AGENT_ICONS[info.agent] : FileText;
  const side = node.labelSide;
  const labelHeightPx = labelHeight(density);

  return (
    <motion.div
      className="stage-node-wrap"
      data-complete={complete ? '' : undefined}
      initial={reduce ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...spring.gentle, delay: reduce ? 0 : node.depth * 0.06 }}
      style={{ left: node.x, top: node.y, width: node.size, height: node.size, marginLeft: -node.size / 2, marginTop: -node.size / 2 }}
    >
      <button
        type="button"
        className="stage-node"
        aria-pressed={selected}
        aria-label={`${info.title}, ${STEP_STATUS_LABEL[info.status]}${info.caption ? `. ${info.caption}` : ''}`}
        title={density === 'band' ? `${info.title} · ${STEP_STATUS_LABEL[info.status]}` : undefined}
        onClick={() => onSelect(node.id)}
      >
        {/* 답변이 시작되면 이 원이 그대로 펼쳐져 읽는 표면이 된다 */}
        {morphId && <motion.span layoutId={morphId} className="orb-morph" style={{ borderRadius: node.size / 2 }} aria-hidden="true" />}
        <Orb size={node.size} status={info.status} tint={tint} icon={Icon} poolId={node.id} />
        {showBadge && (
          <motion.span
            className="orb-badge"
            data-tone={badge.tone}
            data-small={node.size < 44 ? '' : undefined}
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={spring.snappy}
          >
            <badge.icon size={node.size < 44 ? 9 : 12} strokeWidth={3} aria-hidden="true" />
          </motion.span>
        )}
      </button>
      {side !== 'none' && (
        <span
          className="stage-label"
          data-side={side}
          data-selected={selected ? '' : undefined}
          onClick={() => onSelect(node.id)}
          style={
            side === 'below'
              ? { width: node.labelWidth, top: node.size + LABEL_GAP, left: node.size / 2 - node.labelWidth / 2, maxHeight: labelHeightPx }
              : side === 'right'
                ? { width: node.labelWidth, left: node.size + 10, top: 0, height: node.size }
                : { width: node.labelWidth, right: node.size + 10, top: 0, height: node.size }
          }
        >
          <span className={`stage-title text-callout font-semibold ${info.status === 'pending' ? 'text-label-2' : 'text-label'}`}>{info.title}</span>
          {info.caption && (
            <span className="stage-caption text-footnote text-label-2" title={info.caption}>
              {info.caption}
            </span>
          )}
        </span>
      )}
    </motion.div>
  );
}

