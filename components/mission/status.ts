import { AGENTS, type AgentId, type ApprovalRequest, type MissionStatus, type MissionView, type StepStatus } from '@/lib/contracts';
import { ANSWER_NODE, CONDUCTOR_NODE, type StageEdge } from './layout';

/** 필라멘트의 상태. 데이터와 1:1로 대응한다. */
export type EdgeState = 'idle' | 'flow' | 'paused' | 'done' | 'failed' | 'skipped' | 'cancelled';

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: '대기',
  running: '진행 중',
  awaiting_approval: '승인 대기',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
  cancelled: '취소됨',
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  planning: '계획 중',
  awaiting_plan: '계획 승인 대기',
  running: '진행 중',
  awaiting_approval: '승인 대기',
  synthesizing: '결과 정리 중',
  done: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function missionTone(status: MissionStatus): StatusTone {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled') return 'neutral';
  if (status === 'awaiting_approval' || status === 'awaiting_plan') return 'warning';
  return 'accent';
}

export function stepTone(status: StepStatus): StatusTone {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_approval') return 'warning';
  if (status === 'running') return 'accent';
  return 'neutral';
}

/** 이 미션이 승인을 기다리는가 (미션 상태가 running이어도 단계별 대기를 포함) */
export function effectiveMissionStatus(view: Pick<MissionView, 'status' | 'approvals'>): MissionStatus {
  if ((view.status === 'running' || view.status === 'synthesizing') && view.approvals.length > 0) return 'awaiting_approval';
  return view.status;
}

/** 허브(지휘자, 결과) 방울의 상태 */
export function conductorStatus(view: MissionView): StepStatus {
  if (view.status === 'planning') return 'running';
  if (view.status === 'awaiting_plan') return 'awaiting_approval';
  if (view.status === 'cancelled' && !view.plan) return 'cancelled';
  if (view.status === 'failed' && !view.plan) return 'failed';
  return 'done';
}

export function answerStatus(view: MissionView): StepStatus {
  if (view.status === 'synthesizing') return 'running';
  if (view.status === 'done') return 'done';
  if (view.status === 'failed') return 'failed';
  if (view.status === 'cancelled') return 'cancelled';
  return 'pending';
}

function fromStepStatus(status: StepStatus): EdgeState {
  switch (status) {
    case 'running':
      return 'flow';
    case 'awaiting_approval':
      return 'paused';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

/**
 * 필라멘트 상태는 그 선이 이어 주는 아래쪽 단계가 정한다.
 * 결과로 들어가는 선은 위쪽 단계가 끝난 뒤에만 살아난다.
 */
export function edgeState(edge: Pick<StageEdge, 'from' | 'to' | 'kind'>, view: MissionView): EdgeState {
  if (edge.to !== ANSWER_NODE) {
    const target = view.steps[edge.to];
    return target ? fromStepStatus(target.status) : 'idle';
  }
  if (edge.from === CONDUCTOR_NODE) {
    // 단계 없이 바로 답하는 경로
    return fromStepStatus(answerStatus(view));
  }
  const source = view.steps[edge.from];
  if (!source) return 'idle';
  if (source.status === 'skipped') return 'skipped';
  if (source.status === 'failed') return 'failed';
  if (source.status !== 'done') return source.status === 'cancelled' ? 'cancelled' : 'idle';
  if (view.status === 'synthesizing') return 'flow';
  if (view.status === 'done') return 'done';
  if (view.status === 'failed') return 'failed';
  if (view.status === 'cancelled') return 'cancelled';
  return 'done';
}

/** 필라멘트와 방울의 색. 선은 그 선이 끝나는 쪽 에이전트의 색을 띤다. */
export function edgeColorVar(edge: Pick<StageEdge, 'from' | 'to'>, view: MissionView): string {
  const owner = edge.to === ANSWER_NODE ? edge.from : edge.to;
  const agent: AgentId = view.steps[owner]?.step.agent ?? 'conductor';
  return `var(${AGENTS[agent].colorVar})`;
}

/** 경과 시간의 기준: 이번 지시가 시작된 시각. 후속 지시면 그 지시를 받은 때부터 잰다. */
export function turnStart(view: { createdAt: number; turnStartedAt?: number }): number {
  return view.turnStartedAt ?? view.createdAt;
}

/** 단계 라벨 아래에 보여줄 한 줄 */
export function stepCaption(view: MissionView, stepId: string): string {
  const step = view.steps[stepId];
  if (!step) return '';
  const agent = AGENTS[step.step.agent].name;
  switch (step.status) {
    case 'running':
      return step.activity || `${agent} 작업 중`;
    case 'awaiting_approval':
      return '승인을 기다려요';
    case 'failed':
      return '실패했어요';
    case 'skipped':
      return '앞 단계 실패로 건너뜀';
    case 'cancelled':
      return '취소됐어요';
    default:
      return agent;
  }
}

/**
 * 오염 경고를 따로 보여주므로, 같은 말을 하는 서버 사유는 숨긴다.
 * 승인 카드에서 한 가지 경고를 두 번 읽지 않게 하기 위한 것.
 */
export function visibleReason(approval: Pick<ApprovalRequest, 'reason' | 'tainted'>): string | null {
  if (approval.tainted && /외부/.test(approval.reason)) return null;
  return approval.reason;
}

export const TAINT_WARNING = '외부 데이터를 읽은 뒤 나온 요청이에요. 내가 원한 작업이 맞는지 확인해 주세요.';
