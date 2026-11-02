'use client';

import { useId, useState } from 'react';
import { ChevronRight, CircleCheck, CircleSlash, CircleX, RotateCcw, ShieldAlert, Undo2 } from 'lucide-react';
import { AGENTS, type AuditEntry } from '@/lib/contracts';
import { AgentAvatar, Badge, Button } from '@/components/glass';
import { formatClock } from '@/lib/client/format';
import { APPROVED_LABEL, RISK_LABEL, STATUS_LABEL } from './model';

const STATUS_ICON = { ok: CircleCheck, error: CircleX, denied: CircleSlash, blocked: CircleSlash } as const;
const STATUS_COLOR = {
  ok: 'text-success-text',
  error: 'text-danger-text',
  denied: 'text-label-2',
  blocked: 'text-warning-text',
} as const;

export function EntryRow({ entry, onUndo }: { entry: AuditEntry; onUndo: (entry: AuditEntry) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const StatusIcon = STATUS_ICON[entry.status];
  const executed = entry.status === 'ok' || entry.status === 'error';

  return (
    <li className="py-1">
      <div className="flex items-start gap-1 rounded-[14px] hover:bg-fill-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="press flex min-w-0 flex-1 items-start gap-3 rounded-[14px] px-2 py-2 text-left"
        >
          {entry.agent ? (
            <AgentAvatar agent={entry.agent} size="sm" className="mt-0.5 shrink-0" />
          ) : (
            <span className="mt-0.5 size-7 shrink-0 rounded-full bg-fill-3" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className={`block text-callout font-medium break-words ${entry.undoneAt ? 'text-label-2 line-through' : 'text-label'}`}>
              {entry.summary}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-label-2">
              <span className="tabular-nums">{formatClock(entry.at)}</span>
              {entry.agent && <span>{AGENTS[entry.agent].name}</span>}
              <span className={`inline-flex items-center gap-1 ${STATUS_COLOR[entry.status]}`}>
                <StatusIcon size={13} aria-hidden="true" />
                {STATUS_LABEL[entry.status]}
              </span>
              {executed && <span>{APPROVED_LABEL[entry.approvedBy]}</span>}
              {entry.risk === 'confirm' && <Badge tone="warning">{RISK_LABEL.confirm}</Badge>}
              {entry.risk === 'danger' && <Badge tone="danger">{RISK_LABEL.danger}</Badge>}
              {entry.tainted && (
                <Badge tone="warning" icon={ShieldAlert}>
                  외부 내용을 읽은 뒤
                </Badge>
              )}
              {entry.undoneAt && <Badge icon={Undo2}>되돌림</Badge>}
            </span>
          </span>
          <ChevronRight
            size={16}
            className={`mt-1 shrink-0 text-label-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
        {entry.undoable && (
          <Button variant="plain" size="sm" icon={RotateCcw} className="mt-1.5 mr-1" onClick={() => onUndo(entry)}>
            되돌리기
          </Button>
        )}
      </div>

      {open && (
        <div id={panelId} className="mt-1 mb-2 ml-12 mr-2 space-y-2">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-footnote">
            <dt className="text-label-2">도구</dt>
            <dd className="font-mono text-label break-all">{entry.tool}</dd>
            <dt className="text-label-2">시각</dt>
            <dd className="text-label tabular-nums">{new Date(entry.at).toLocaleString('ko-KR', { hour12: false })}</dd>
            <dt className="text-label-2">위험 등급</dt>
            <dd className="text-label">{RISK_LABEL[entry.risk]}</dd>
            {entry.undoneAt && (
              <>
                <dt className="text-label-2">되돌린 시각</dt>
                <dd className="text-label tabular-nums">{new Date(entry.undoneAt).toLocaleString('ko-KR', { hour12: false })}</dd>
              </>
            )}
          </dl>
          {entry.tainted && (
            <p className="text-footnote text-label-2">
              에이전트가 파일이나 웹처럼 외부에서 온 내용을 읽은 뒤에 일어난 작업이에요.
            </p>
          )}
          {entry.result ? (
            <pre className="max-h-56 overflow-auto rounded-[12px] bg-fill-3 p-3 font-mono text-footnote whitespace-pre-wrap break-words text-label">
              {entry.result}
            </pre>
          ) : (
            <p className="text-footnote text-label-2">남겨진 결과가 없어요.</p>
          )}
        </div>
      )}
    </li>
  );
}
