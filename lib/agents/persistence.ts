import { promises as fs } from 'node:fs';
import type { AgentId, ApprovalRequest, MissionEvent, MissionSummary, MissionView } from '@/lib/contracts';
import { appendLine, dataPath, readJson, withJsonFile, writeJson } from '@/lib/store/json';
import { applyMissionEvent } from '@/lib/missions/reducer';

const SNAPSHOT_INTERVAL_MS = 1000;
const EVENT_FLUSH_MS = 200;
const MISSION_ID = /^m_[a-z0-9]+$/;
/** 재시작으로 끊긴 승인의 입력을 후속 지시나 삭제가 없어도 지우는 기한 */
const INTERRUPTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 라우트 파라미터가 그대로 경로가 되므로 형식을 먼저 검사한다. */
export function isMissionId(id: string): boolean {
  return MISSION_ID.test(id);
}

function missionsDir(): string {
  return dataPath('missions');
}

function eventsPath(id: string): string {
  return dataPath('missions', `${id}.jsonl`);
}

function snapshotPath(id: string): string {
  return dataPath('missions', `${id}.json`);
}

export function summaryOf(view: MissionView): MissionSummary {
  const agents: AgentId[] = [...new Set((view.plan?.steps ?? []).map((s) => s.agent as AgentId))];
  return {
    id: view.id,
    goal: view.goal,
    title: view.title,
    status: view.status,
    mode: view.mode,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    finishedAt: view.finishedAt,
    costUsd: view.usage.costUsd,
    pendingApprovals: view.approvals.length,
    agents,
  };
}

export async function loadSnapshot(id: string): Promise<MissionView | null> {
  const view = await readJson<MissionView | null>(snapshotPath(id), null);
  if (!view) return null;
  // 이전 버전이 저장한 스냅샷에는 턴 기준값이 없다.
  return { ...view, turnStartCostUsd: view.turnStartCostUsd ?? 0, turnStartedAt: view.turnStartedAt ?? view.createdAt };
}

/** 승인 미리보기와 카드 요약에는 내용이 들어 있다. 화면에는 보여주되 디스크에는 남기지 않는다. */
function withoutContent(approval: ApprovalRequest): ApprovalRequest {
  const copy = { ...approval, summary: approval.recordSummary ?? approval.summary };
  delete copy.preview;
  delete copy.recordSummary;
  return copy;
}

export function persistableEvent(event: MissionEvent): MissionEvent {
  return event.type === 'approval.requested' ? { ...event, approval: withoutContent(event.approval) } : event;
}

// ─── 승인을 기다리는 입력 원문 ───────────────────────────────
/**
 * 이벤트 로그는 추가만 하고 리듀서는 클라이언트와 공유하므로, 원문은 처음부터 로그에 넣지 않고 따로 둔다.
 * 결정이 나면 파일에서 지운다. 내보내기가 읽는 missions 폴더 밖에 둔다.
 */
export interface PendingInput {
  callId?: string;
  stepId?: string;
  tool?: string;
  input: unknown;
  requestedAt: number;
  /** 승인을 기다리던 중 앱이 재시작된 시각. 이때부터 미션은 끝났고 입력은 볼 수만 있다. */
  interruptedAt?: number;
}

type PendingFile = Record<string, PendingInput>;

function pendingPath(id: string): string {
  return dataPath('missions-pending', `${id}.json`);
}

function changePending(id: string, change: (current: PendingFile) => PendingFile): Promise<void> {
  const path = pendingPath(id);
  return withJsonFile<PendingFile, void>(path, {}, async (current, write) => {
    const next = change(current);
    if (Object.keys(next).length === 0) await fs.rm(path, { force: true });
    else await write(next);
  });
}

export function loadPendingInputs(id: string): Promise<PendingFile> {
  return readJson<PendingFile>(pendingPath(id), {});
}

/** 후속 지시나 미션 삭제: 끊긴 승인의 입력까지 전부 지운다. */
export function removePendingInputs(id: string): Promise<void> {
  return changePending(id, () => ({}));
}

/**
 * 재시작 때 부른다. 아직 대기 중이던 승인의 입력은 끊긴 것으로 표시해 남기고, 그 외에는 지운다
 * (결정은 났는데 지우기 전에 죽었거나 기한이 지난 것). 끊긴 호출의 id를 돌려준다.
 */
export async function settlePendingInputs(id: string, pendingApprovalIds: string[], now = Date.now()): Promise<string[]> {
  const interrupted: string[] = [];
  await changePending(id, (current) => {
    const next: PendingFile = {};
    for (const [approvalId, entry] of Object.entries(current)) {
      if (pendingApprovalIds.includes(approvalId)) {
        next[approvalId] = { ...entry, interruptedAt: now };
        if (entry.callId) interrupted.push(entry.callId);
      } else if (entry.interruptedAt && now - entry.interruptedAt < INTERRUPTED_RETENTION_MS) {
        next[approvalId] = entry;
      }
    }
    return next;
  });
  return interrupted;
}

/** 끊긴 승인의 입력을 그 도구 호출의 입력 칸에 보여준다. 저장본은 건드리지 않고 응답에만 얹는다. */
export function withInterruptedInputs(view: MissionView, pending: PendingFile): MissionView {
  const inputs = new Map(
    Object.values(pending).flatMap((entry) => (entry.interruptedAt && entry.callId ? [[entry.callId, entry.input] as const] : []))
  );
  if (inputs.size === 0) return view;
  const steps = Object.fromEntries(
    Object.entries(view.steps).map(([id, step]) => [
      id,
      { ...step, toolCalls: step.toolCalls.map((call) => (inputs.has(call.callId) ? { ...call, input: inputs.get(call.callId) } : call)) },
    ])
  );
  return { ...view, steps };
}

/** 강제 종료로 마지막 줄이 줄바꿈 없이 끊겼으면 다음 기록이 그 줄에 붙지 않도록 줄을 끝낸다. */
export async function repairEventLogTail(id: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath(id), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (raw && !raw.endsWith('\n')) await appendLine(eventsPath(id), '');
}

/** 이벤트 로그를 읽는다. 강제 종료로 마지막 줄이 깨졌을 수 있어 그 줄은 버린다. */
export async function loadEvents(id: string): Promise<MissionEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath(id), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const events: MissionEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as MissionEvent);
    } catch {
      /* 잘린 줄 */
    }
  }
  return events;
}

export function replayEvents(events: MissionEvent[]): MissionView | null {
  let view: MissionView | null = null;
  for (const event of events) view = applyMissionEvent(view, event);
  return view;
}

export async function listStoredMissionIds(): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(missionsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const ids = new Set<string>();
  for (const name of names) {
    const match = /^(m_[a-z0-9]+)\.jsonl?$/.exec(name);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

export async function deleteStoredMission(id: string): Promise<void> {
  await Promise.all([
    fs.rm(eventsPath(id), { force: true }),
    fs.rm(snapshotPath(id), { force: true }),
    removePendingInputs(id),
  ]);
}

/** 이벤트는 모아서 추가하고, 스냅샷은 주기적으로만 쓴다. */
export class MissionWriter {
  private lines: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private latest: MissionView | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly id: string) {}

  record(event: MissionEvent, view: MissionView) {
    this.lines.push(JSON.stringify(persistableEvent(event)));
    this.latest = view;
    this.flushTimer ??= setTimeout(() => this.flushLines(), EVENT_FLUSH_MS);
    this.snapshotTimer ??= setTimeout(() => this.writeSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  private flushLines() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.lines.length === 0) return;
    const batch = this.lines.join('\n');
    this.lines = [];
    this.chain = this.chain.then(() => appendLine(eventsPath(this.id), batch)).catch(logWriteError);
  }

  private writeSnapshot() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    const latest = this.latest;
    if (!latest) return;
    const view = { ...latest, approvals: latest.approvals.map(withoutContent) };
    this.chain = this.chain.then(() => writeJson(snapshotPath(this.id), view)).catch(logWriteError);
  }

  /** 승인을 기다리는 동안만 입력 원문을 둔다. 저장에 실패해도 승인 카드는 메모리로 계속 동작한다. */
  savePending(approval: ApprovalRequest, input: unknown) {
    const entry: PendingInput = { callId: approval.callId, stepId: approval.stepId, tool: approval.tool, input, requestedAt: approval.requestedAt };
    this.chain = this.chain.then(() => changePending(this.id, (current) => ({ ...current, [approval.id]: entry }))).catch(logWriteError);
  }

  dropPending(approvalId: string) {
    this.chain = this.chain
      .then(() =>
        changePending(this.id, (current) => {
          const next = { ...current };
          delete next[approvalId];
          return next;
        })
      )
      .catch(logWriteError);
  }

  /** 미션이 끝났다. 재시작으로 끊겨 볼 수만 있는 입력 말고는 남기지 않는다. */
  dropUndecidedPending() {
    this.chain = this.chain
      .then(() => changePending(this.id, (current) => Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.interruptedAt))))
      .catch(logWriteError);
  }

  /** 지금까지의 내용을 디스크에 쓴다. */
  flush(): Promise<void> {
    this.flushLines();
    this.writeSnapshot();
    return this.chain;
  }
}

function logWriteError(err: unknown) {
  console.error('[mission] 저장 실패', err);
}

