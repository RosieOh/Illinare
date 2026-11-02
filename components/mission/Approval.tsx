'use client';

import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { AGENTS, type ApprovalDecision, type ApprovalPreview, type ApprovalRequest, type MissionPlan } from '@/lib/contracts';
import { AgentAvatar, Badge, Button, LiquidGlass, Sheet, useToast } from '@/components/glass';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';
import { capRows, collapseUnchanged, lineDiff, type DiffCell } from './diff';
import { closeApprovalDetails } from './selection';
import { TAINT_WARNING, visibleReason } from './status';
import { useApprovalArmed } from './useApprovalArmed';

/** 승인 결정 전달. 실패하면 알리고 다시 시도할 수 있게 둔다. */
function useDecision(missionId: string, approvalId: string) {
  const { decide } = useMissions();
  const toast = useToast();
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const send = async (decision: ApprovalDecision, remember?: boolean) => {
    setBusy(decision);
    try {
      await decide(missionId, approvalId, decision, remember);
    } catch (err) {
      toast({
        tone: 'danger',
        title: '결정을 전달하지 못했어요',
        description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setBusy(null);
    }
  };
  return { busy, send };
}

function RiskBadge({ risk }: { risk: ApprovalRequest['risk'] }) {
  if (risk === 'danger') return <Badge tone="danger">위험</Badge>;
  if (risk === 'confirm') return <Badge tone="warning" className="approval-pill">변경</Badge>;
  return <Badge>검토</Badge>;
}

function approvalTitle(approval: ApprovalRequest): string {
  return approval.kind === 'plan' ? '이 계획대로 진행할까요?' : `${AGENTS[approval.agent].name}의 작업을 승인할까요?`;
}

/**
 * 스테이지에 떠 있는 승인 카드. 한 표면에 전부 담는다: 카드 안의 카드가 없다.
 * 기본 포커스를 주지 않는다. 다른 곳에서 치던 Enter가 승인으로 이어지면 안 된다.
 */
export function ApprovalFloat({
  missionId,
  approval,
  more,
  onDetails,
  className,
  style,
}: {
  missionId: string;
  approval: ApprovalRequest;
  /** 이 카드 말고 더 기다리는 승인 수 */
  more: number;
  onDetails: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { busy, send } = useDecision(missionId, approval.id);
  const armed = useApprovalArmed(approval.id);
  const danger = approval.risk === 'danger';
  const reason = visibleReason(approval);
  return (
    <LiquidGlass tint="thick" radius={24} className={`approval-card ${className ?? ''}`} style={style} role="group" aria-label="승인 요청" data-approval-ui="">
      {/* 내용이 길면 이 영역만 스크롤한다. 거부와 승인은 항상 보인다. */}
      <div className="approval-card-body">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 text-callout font-semibold text-label">{approvalTitle(approval)}</h3>
          {more > 0 && <Badge>외 {more}건</Badge>}
          <RiskBadge risk={approval.risk} />
        </div>
        <p className="mt-1.5 text-callout break-all text-label">{approval.summary}</p>
        {reason && <p className="mt-0.5 text-subhead text-label-2">{reason}</p>}
        {approval.preview?.truncated && <p className="mt-0.5 text-subhead text-label-2">내용이 길어 일부만 미리 볼 수 있어요. 자세히에서 앞과 뒤를 확인해 주세요.</p>}
        {approval.tainted && (
          <p className="mt-1.5 flex items-start gap-1.5 text-subhead text-warning-text">
            <TriangleAlert size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
            <span>{TAINT_WARNING}</span>
          </p>
        )}
      </div>
      <div className="approval-card-actions">
        <Button size="sm" variant="plain" onClick={onDetails}>
          자세히
        </Button>
        <span className="flex-1" />
        <Button size="md" variant="secondary" disabled={busy !== null} loading={busy === 'deny'} className="!rounded-full" onClick={() => void send('deny')}>
          거부
        </Button>
        <Button
          size="md"
          variant={danger ? 'danger' : 'primary'}
          disabled={busy !== null || !armed}
          loading={busy === 'approve'}
          className="!rounded-full"
          onClick={() => void send('approve')}
        >
          승인
        </Button>
      </div>
    </LiquidGlass>
  );
}

function DiffSide({ cell, side }: { cell: DiffCell | null; side: 'left' | 'right' }) {
  if (!cell) {
    return (
      <div className="diff-cell" data-side={side} data-empty="">
        <span className="diff-line" />
        <span className="diff-text" />
      </div>
    );
  }
  return (
    <div className="diff-cell" data-side={side} data-changed={cell.changed ? '' : undefined}>
      <span className="diff-line">{cell.line}</span>
      <span className="diff-text">{cell.text || ' '}</span>
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => collapseUnchanged(lineDiff(before, after)), [before, after]);
  const added = rows.reduce((n, r) => n + (r?.right?.changed ? 1 : 0), 0);
  const removed = rows.reduce((n, r) => n + (r?.left?.changed ? 1 : 0), 0);
  return (
    <div>
      <p className="mb-1.5 text-footnote text-label-2">{before ? `${removed}줄 삭제, ${added}줄 추가` : `새 파일, ${added}줄`}</p>
      <div className="diff max-h-[44vh]" role="table" aria-label="변경 전후 비교">
        <div className="diff-row sticky top-0 z-[1] bg-surface font-sans text-footnote font-medium text-label-2" role="row">
          <span className="px-3 py-1" role="columnheader">
            변경 전
          </span>
          <span className="px-3 py-1" role="columnheader">
            변경 후
          </span>
        </div>
        {capRows(rows).map((row, i) =>
          row && 'hidden' in row ? (
            <div key={i} className="diff-fold text-footnote" role="row">
              가운데 {row.hidden.toLocaleString()}줄은 너무 길어 그리지 않았어요
            </div>
          ) : row ? (
            <div key={i} className="diff-row" role="row">
              <DiffSide cell={row.left} side="left" />
              <DiffSide cell={row.right} side="right" />
            </div>
          ) : (
            <div key={i} className="diff-fold text-footnote" role="row">
              변경 없는 부분을 접었어요
            </div>
          )
        )}
      </div>
    </div>
  );
}

function PreviewBlock({ preview }: { preview: ApprovalPreview }) {
  return (
    <div className="mt-3">
      {preview.path && <p className="mb-1.5 font-mono text-footnote break-all text-label-2">{preview.path}</p>}
      {preview.kind === 'diff' ? (
        <DiffView before={preview.before ?? ''} after={preview.after ?? ''} />
      ) : (
        <pre className="mono-block" tabIndex={0}>
          {preview.text ?? ''}
        </pre>
      )}
      {preview.truncated && <p className="mt-1.5 text-footnote text-label-2">내용이 길어 앞과 뒤만 보여줘요. 실제 작업은 전체 내용에 적용돼요.</p>}
    </div>
  );
}

function PlanPreview({ plan }: { plan: MissionPlan }) {
  return (
    <ol className="mt-3 space-y-2">
      {plan.steps.map((step, i) => (
        <li key={step.id} className="flex items-start gap-2.5">
          <AgentAvatar agent={step.agent} size={26} decorative className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-callout font-medium text-label">
              {i + 1}. {step.title}
            </p>
            <p className="text-subhead text-label-2">{step.task}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 승인 전에 정확히 무엇이 바뀌는지 보여주는 시트. */
export function ApprovalSheet({ missionId, approval, plan }: { missionId: string; approval: ApprovalRequest | null; plan: MissionPlan | null }) {
  return (
    <Sheet open={Boolean(approval)} onClose={closeApprovalDetails} title={approval ? approvalTitle(approval) : undefined} width={760}>
      {approval && <ApprovalSheetBody key={approval.id} missionId={missionId} approval={approval} plan={plan} />}
    </Sheet>
  );
}

function ApprovalSheetBody({ missionId, approval, plan }: { missionId: string; approval: ApprovalRequest; plan: MissionPlan | null }) {
  const { busy, send } = useDecision(missionId, approval.id);
  const armed = useApprovalArmed(approval.id);
  const [remember, setRemember] = useState(false);
  const danger = approval.risk === 'danger';
  const canRemember = approval.kind === 'tool' && !danger && !approval.tainted;
  const reason = visibleReason(approval);

  return (
    <div data-approval-ui="">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-headline break-all text-label">{approval.summary}</p>
          {reason && <p className="mt-0.5 text-callout text-label-2">{reason}</p>}
          {approval.tool && <p className="mt-1 font-mono text-footnote text-label-2">{approval.tool}</p>}
        </div>
        <RiskBadge risk={approval.risk} />
      </div>

      {danger && <p className="mt-2 text-subhead text-danger-text">되돌리기 어려울 수 있는 작업이에요. 이 등급은 항상 먼저 물어봐요.</p>}
      {approval.tainted && (
        <p className="mt-2 flex items-start gap-1.5 text-subhead text-warning-text">
          <TriangleAlert size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          <span>{TAINT_WARNING}</span>
        </p>
      )}

      {approval.preview ? (
        <PreviewBlock preview={approval.preview} />
      ) : approval.kind === 'plan' && plan ? (
        <PlanPreview plan={plan} />
      ) : (
        <p className="mt-3 text-subhead text-label-2">이 작업은 미리 보여줄 내용이 없어요.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {canRemember && (
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-subhead text-label-2">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 cursor-pointer rounded accent-[var(--accent-fill)]"
            />
            이 도구는 앞으로 묻지 않기
          </label>
        )}
        <Button variant="secondary" disabled={busy !== null} loading={busy === 'deny'} className="!rounded-full" onClick={() => void send('deny')}>
          거부
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy !== null || !armed}
          loading={busy === 'approve'}
          className="!rounded-full"
          onClick={() => void send('approve', canRemember && remember)}
        >
          승인
        </Button>
      </div>
    </div>
  );
}
