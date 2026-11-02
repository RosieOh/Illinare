import type { ApprovalDecision, ApprovalRequest } from '@/lib/contracts';
import { setToolPolicy } from '@/lib/store/settings';
import { CancelledError } from './errors';

/** 오염된 단계가 웹으로 나가기 전에 묻는 승인의 이름. 실제 도구가 아니다. */
export const WEB_ACCESS_APPROVAL = 'web_access';

interface Waiter {
  approval: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  reject: (err: Error) => void;
}

/** 대기 중인 승인. 라우트마다 번들이 나뉘어도 공유되도록 globalThis에 둔다. */
const holder = globalThis as unknown as { __illionaireApprovals?: Map<string, Map<string, Waiter>> };
const hub = (holder.__illionaireApprovals ??= new Map());

/**
 * 승인을 기다린다. 이 단계만 멈추고 다른 단계는 계속 달린다.
 * 서버가 이 결정을 소유하므로 클라이언트는 id와 결정 외에 아무것도 보낼 수 없다.
 */
export function requestApproval(missionId: string, approval: ApprovalRequest): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    let waiters = hub.get(missionId);
    if (!waiters) {
      waiters = new Map();
      hub.set(missionId, waiters);
    }
    waiters.set(approval.id, { approval, resolve, reject });
  });
}

export function hasApproval(missionId: string, approvalId: string): boolean {
  return hub.get(missionId)?.has(approvalId) ?? false;
}

/** 결정을 전달한다. 이미 처리됐거나 없는 승인이면 false. */
export async function resolveApproval(
  missionId: string,
  approvalId: string,
  decision: ApprovalDecision,
  remember = false
): Promise<boolean> {
  const waiters = hub.get(missionId);
  const waiter = waiters?.get(approvalId);
  if (!waiters || !waiter) return false;
  waiters.delete(approvalId);

  // 위험 도구는 "항상 허용"을 저장하지 않는다.
  const { approval } = waiter;
  // web_access는 오염된 단계마다 묻는 것이 목적이므로 항상 허용으로 저장하지 않는다.
  if (remember && decision === 'approve' && approval.kind === 'tool' && approval.tool && approval.tool !== WEB_ACCESS_APPROVAL && approval.risk !== 'danger') {
    // 저장에 실패해도 이번 결정은 전달한다. 그렇지 않으면 단계가 영원히 멈춘다.
    await setToolPolicy(approval.tool, 'allow').catch((err: unknown) => console.error('[approval] 정책 저장 실패', err));
  }
  waiter.resolve(decision);
  return true;
}

/** 미션 취소: 대기 중인 승인을 모두 끝내고 그 목록을 돌려준다. */
export function cancelApprovals(missionId: string): ApprovalRequest[] {
  const waiters = hub.get(missionId);
  if (!waiters) return [];
  hub.delete(missionId);
  const pending = [...waiters.values()];
  for (const w of pending) w.reject(new CancelledError());
  return pending.map((w) => w.approval);
}
