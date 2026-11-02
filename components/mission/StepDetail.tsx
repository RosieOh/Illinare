'use client';

import { useState } from 'react';
import { Ban, Check, ChevronRight, Circle, Hand, Loader2, RotateCcw, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { AGENTS, type MissionView, type StepView, type ToolCallStatus, type ToolCallView } from '@/lib/contracts';
import { AgentAvatar, Badge, Button, IconButton, Markdown, useToast } from '@/components/glass';
import { api, ClientApiError } from '@/lib/client/api';
import { formatCost, formatElapsed } from '@/lib/client/format';
import { useNow } from '@/utils/useNow';
import { ApprovalFloat } from './Approval';
import { openApprovalDetails } from './selection';
import { stepTone, STEP_STATUS_LABEL } from './status';

const CALL_ICON: Record<ToolCallStatus, { icon: LucideIcon; className: string; label: string }> = {
  running: { icon: Loader2, className: 'animate-spin text-accent-text', label: '진행 중' },
  ok: { icon: Check, className: 'text-success-text', label: '완료' },
  error: { icon: TriangleAlert, className: 'text-danger-text', label: '오류' },
  denied: { icon: Ban, className: 'text-label-2', label: '거부됨' },
  blocked: { icon: Ban, className: 'text-danger-text', label: '차단됨' },
};

function prettyJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  } catch {
    return String(value);
  }
}

function ToolCallRow({ call, now, waiting }: { call: ToolCallView; now: number; waiting: boolean }) {
  const toast = useToast();
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const meta = waiting ? { icon: Hand, className: 'text-warning-text', label: '승인 대기' } : CALL_ICON[call.status];
  const ms = (call.finishedAt ?? (now || call.startedAt)) - call.startedAt;

  const undo = async () => {
    setUndoing(true);
    try {
      const res = await api.post<{ ok: true; message: string }>(`/api/audit/${call.undoId}/undo`);
      setUndone(true);
      toast({ tone: 'success', title: '되돌렸어요', description: res.message });
    } catch (err) {
      toast({
        tone: 'danger',
        title: '되돌리지 못했어요',
        description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <li className="relative pl-6">
      <span className="absolute top-[3px] left-0 flex size-[18px] items-center justify-center" aria-hidden="true">
        <meta.icon size={15} className={meta.className} />
      </span>
      <details className="disclosure">
        <summary className="flex items-start gap-1.5 rounded-md text-callout text-label">
          <span className="min-w-0 flex-1">
            <span className="break-words">{call.summary}</span>
            <span className="sr-only-live"> {meta.label}</span>
          </span>
          <span className="shrink-0 pt-0.5 text-footnote text-label-2">{formatElapsed(Math.max(ms, 0))}</span>
          <ChevronRight size={14} className="disclosure-chevron mt-1 shrink-0 text-label-2" aria-hidden="true" />
        </summary>
        <div className="mt-2 space-y-2 pb-1">
          <div>
            <p className="mb-1 text-footnote font-medium text-label-2">입력</p>
            <pre className="mono-block" tabIndex={0}>
              {prettyJson(call.input)}
            </pre>
          </div>
          {call.result !== undefined && (
            <div>
              <p className="mb-1 text-footnote font-medium text-label-2">결과</p>
              <pre className="mono-block" tabIndex={0}>
                {call.result.length > 6000 ? `${call.result.slice(0, 6000)}\n…` : call.result}
              </pre>
            </div>
          )}
        </div>
      </details>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {call.risk === 'danger' && <Badge tone="danger">위험</Badge>}
        {call.risk === 'confirm' && <Badge tone="warning" className="approval-pill">변경</Badge>}
        {call.serverSide && <Badge>Anthropic 서버에서 실행</Badge>}
        {call.status === 'denied' && <Badge>거부됨</Badge>}
        {call.status === 'blocked' && <Badge tone="danger">차단됨</Badge>}
        {call.status === 'error' && <Badge tone="danger">오류</Badge>}
        {call.undoId &&
          (undone ? (
            <Badge tone="success" icon={Check}>
              되돌림
            </Badge>
          ) : (
            <Button size="sm" variant="plain" icon={RotateCcw} loading={undoing} className="!h-[22px] !rounded-full !px-2 !text-footnote" onClick={() => void undo()}>
              되돌리기
            </Button>
          ))}
      </div>
    </li>
  );
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  if (!text) return null;
  return (
    <details className="disclosure mt-3">
      <summary className="flex items-center gap-1.5 rounded-md text-subhead font-medium text-label-2">
        <ChevronRight size={14} className="disclosure-chevron shrink-0" aria-hidden="true" />
        생각 과정 요약
        {live && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />}
      </summary>
      <p className="mt-1.5 whitespace-pre-wrap text-subhead text-label-2">{text}</p>
    </details>
  );
}

function usageLine(step: StepView, mode: MissionView['mode']): string {
  if (mode === 'demo') return '데모라 실제 사용량이 없어요';
  const input = step.usage.inputTokens + step.usage.cacheReadTokens + step.usage.cacheWriteTokens;
  if (input === 0 && step.usage.outputTokens === 0) return '아직 사용량이 없어요';
  return `입력 ${input.toLocaleString()} · 출력 ${step.usage.outputTokens.toLocaleString()} 토큰 · ${formatCost(step.usage.costUsd)}`;
}

/** 단계 하나가 무엇을 했는지 전부 보여주는 패널 */
export function StepDetailBody({ view, step }: { view: MissionView; step: StepView }) {
  const now = useNow();
  const live = step.status === 'running' || step.status === 'awaiting_approval';
  const approvals = view.approvals.filter((a) => a.stepId === step.step.id);
  const waitingCalls = new Set(approvals.map((a) => a.callId));
  return (
    <div>
      <p className="text-callout text-label-2">{step.step.task}</p>

      {step.tainted && (
        <p className="mt-3 flex items-start gap-2 rounded-[12px] bg-fill-3 px-3 py-2 text-subhead text-label-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
          <span>
            이 단계는 파일이나 웹처럼 바깥에서 온 내용을 읽었어요. 그 안에 숨은 지시가 섞여 있을 수 있어서, 이후 정보를 밖으로 보내는 작업은 먼저 물어봐요.
          </span>
        </p>
      )}

      {approvals.length > 0 && (
        <div className="mt-3 space-y-2">
          {approvals.map((approval) => (
            <ApprovalFloat key={approval.id} missionId={view.id} approval={approval} more={0} onDetails={() => openApprovalDetails(view.id, approval.id)} />
          ))}
        </div>
      )}

      <Thinking text={step.thinking} live={step.status === 'running'} />

      {step.toolCalls.length > 0 && (
        <section className="mt-4" aria-label="도구 호출">
          <h4 className="mb-2 text-subhead font-semibold text-label">도구 호출 {step.toolCalls.length}건</h4>
          <ol className="space-y-3">
            {step.toolCalls.map((call) => (
              <ToolCallRow key={call.callId} call={call} now={now} waiting={waitingCalls.has(call.callId)} />
            ))}
          </ol>
        </section>
      )}

      {(step.output || step.text) && (
        <section className="mt-4" aria-label="결과">
          <h4 className="mb-1 text-subhead font-semibold text-label">{step.output ? '넘겨준 결과' : '작성 중'}</h4>
          <Markdown className="!text-callout">{step.output ?? step.text}</Markdown>
        </section>
      )}

      {step.error && (
        <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-3 py-2 text-subhead text-danger-text" role="alert">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{step.error}</span>
        </p>
      )}

      {live && !step.toolCalls.length && !step.text && !step.thinking && approvals.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-subhead text-label-2">
          <Circle size={8} className="animate-pulse fill-current" aria-hidden="true" />
          시작하고 있어요
        </p>
      )}

      <p className="mt-4 text-footnote text-label-2">{usageLine(step, view.mode)}</p>
    </div>
  );
}

export function StepHeader({ step, onClose }: { step: StepView; onClose: () => void }) {
  const agent = AGENTS[step.step.agent];
  return (
    <header className="flex items-start gap-2.5">
      <AgentAvatar agent={step.step.agent} size={36} status={step.status} decorative />
      <div className="min-w-0 flex-1">
        <h3 className="text-headline text-label">{step.step.title}</h3>
        <p className="text-footnote text-label-2">
          {agent.name} · {agent.role}
        </p>
        <div className="mt-1.5">
          <Badge tone={stepTone(step.status)} dot>
            {STEP_STATUS_LABEL[step.status]}
          </Badge>
        </div>
      </div>
      <IconButton icon={X} label="단계 상세 닫기" size="sm" tooltip={false} onClick={onClose} />
    </header>
  );
}

/** 지휘자를 눌렀을 때: 왜 이렇게 나눴는지 */
export function ConductorDetail({ view, onClose }: { view: MissionView; onClose: () => void }) {
  return (
    <div>
      <header className="flex items-start gap-2.5">
        <AgentAvatar agent="conductor" size={36} decorative />
        <div className="min-w-0 flex-1">
          <h3 className="text-headline text-label">{AGENTS.conductor.name}</h3>
          <p className="text-footnote text-label-2">{AGENTS.conductor.role}</p>
        </div>
        <IconButton icon={X} label="지휘자 상세 닫기" size="sm" tooltip={false} onClick={onClose} />
      </header>
      {view.plan?.rationale && <p className="mt-3 text-callout text-label">{view.plan.rationale}</p>}
      {view.plan && view.plan.steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {view.plan.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <AgentAvatar agent={step.agent} size={22} decorative className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-callout font-medium text-label">{step.title}</p>
                <p className="text-subhead text-label-2">{step.task}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {view.conductorThinking && (
        <section className="mt-4">
          <h4 className="mb-1 text-subhead font-semibold text-label">생각 과정 요약</h4>
          <p className="whitespace-pre-wrap text-subhead text-label-2">{view.conductorThinking}</p>
        </section>
      )}
    </div>
  );
}

