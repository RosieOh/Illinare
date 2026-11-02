import './index';
import { appendAudit, getStoredAudit, markUndone, type StoredAuditEntry } from '@/lib/store/audit';
import { restoreJournal } from '@/lib/store/journal';
import { getTool, isAvailable, type ToolAttachment, type ToolContext, type ToolDef, type ToolOutcome } from './registry';
import { ValidationError, validateInput } from './validate';

const AUDIT_RESULT_LIMIT = 300;

export interface ExecuteResult {
  status: 'ok' | 'error';
  /** 모델에게만 주는 전체 결과. 미션 이벤트나 내보내기에 저장하지 않는다. */
  content: string;
  /** 화면과 저장용 결과. 파일이나 클립보드를 읽는 도구는 본문 대신 짧은 안내만 담는다. */
  displayContent: string;
  /** 되돌릴 수 있으면 감사 기록 id (POST /api/audit/[id]/undo) */
  undoId?: string;
  auditId: string;
  attachment?: ToolAttachment;
}

export interface ExecuteMeta {
  approvedBy: 'auto' | 'user' | 'policy';
  tainted: boolean;
}

function summarizeSafely(tool: ToolDef<unknown> | undefined, name: string, input: unknown): string {
  if (!tool) return name;
  try {
    return tool.summarize(input);
  } catch {
    return name;
  }
}

/** 감사 기록 실패가 도구 결과를 망치지 않도록 감싼다. */
async function audit(entry: Parameters<typeof appendAudit>[0]): Promise<StoredAuditEntry | null> {
  try {
    return await appendAudit(entry);
  } catch (err) {
    console.error('[audit]', err);
    return null;
  }
}

/** 파일이나 클립보드 내용은 감사 기록에 남기지 않는다. */
function auditResult(tool: ToolDef<unknown> | undefined, content: string, status: 'ok' | 'error'): string | undefined {
  if (status === 'ok' && tool?.readsUntrusted) return undefined;
  return content.slice(0, AUDIT_RESULT_LIMIT);
}

/** 저장해도 되는 결과. 외부 데이터를 읽는 도구의 본문은 모델에게만 가고 디스크에 남지 않는다. */
function displayResult(
  tool: ToolDef<unknown> | undefined,
  content: string,
  status: 'ok' | 'error',
  attachment: ToolAttachment | undefined
): string {
  if (status !== 'ok' || !tool?.readsUntrusted) return content;
  if (attachment) return `${attachment.kind === 'pdf' ? 'PDF' : '이미지'} 첨부를 읽었어요. 저장하지 않았어요.`;
  return `내용 ${content.length.toLocaleString('ko-KR')}자를 읽었어요. 저장하지 않았어요.`;
}

/** 입력을 검증하고 실행하고 감사 기록을 남긴다. 절대 throw 하지 않는다. */
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  meta: ExecuteMeta
): Promise<ExecuteResult> {
  const tool = getTool(name);
  let status: 'ok' | 'error' = 'error';
  let content: string;
  let journalId: string | undefined;
  let attachment: ToolAttachment | undefined;

  if (!tool) {
    content = `알 수 없는 도구입니다: ${name}`;
  } else if (!isAvailable(tool)) {
    content = `이 컴퓨터에서는 쓸 수 없는 도구입니다: ${name}`;
  } else {
    try {
      const validated = validateInput(tool.schema, rawInput);
      const out: string | ToolOutcome = await tool.run(validated, ctx);
      status = 'ok';
      if (typeof out === 'string') {
        content = out;
      } else {
        content = out.content;
        journalId = out.journalId;
        attachment = out.attachment;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      content = err instanceof ValidationError ? `입력 검증 실패: ${message}` : `오류: ${message}`;
    }
  }

  const entry = await audit({
    missionId: ctx.missionId,
    agent: ctx.agent,
    tool: name,
    summary: summarizeSafely(tool, name, rawInput),
    risk: tool?.risk ?? 'safe',
    status,
    approvedBy: meta.approvedBy,
    tainted: meta.tainted || undefined,
    result: auditResult(tool, content, status),
    journalId,
  });

  return {
    status,
    content,
    displayContent: displayResult(tool, content, status, attachment),
    undoId: journalId && entry ? entry.id : undefined,
    auditId: entry?.id ?? '',
    attachment,
  };
}

/** 사용자가 거부했거나 정책으로 막힌 호출도 기록한다. */
export async function recordDenied(
  name: string,
  input: unknown,
  ctx: ToolContext,
  status: 'denied' | 'blocked',
  tainted: boolean
): Promise<void> {
  const tool = getTool(name);
  await audit({
    missionId: ctx.missionId,
    agent: ctx.agent,
    tool: name,
    summary: summarizeSafely(tool, name, input),
    risk: tool?.risk ?? 'safe',
    status,
    approvedBy: status === 'blocked' ? 'policy' : 'user',
    tainted: tainted || undefined,
  });
}

/** 감사 기록 하나를 되돌린다. 되돌릴 수 없으면 사용자에게 보여줄 message로 throw 한다. */
export async function undoAudit(id: string): Promise<{ message: string }> {
  const entry = await getStoredAudit(id);
  if (!entry) throw new Error('활동 기록을 찾을 수 없습니다.');
  if (entry.undoneAt) throw new Error('이미 되돌린 작업입니다.');
  if (!entry.journalId) throw new Error('이 작업은 되돌릴 수 없습니다.');
  const { message } = await restoreJournal(entry.journalId);
  await markUndone(id);
  await audit({
    missionId: entry.missionId,
    tool: entry.tool,
    summary: `되돌리기: ${entry.summary}`,
    risk: entry.risk,
    status: 'ok',
    approvedBy: 'user',
    result: message,
  });
  return { message };
}
