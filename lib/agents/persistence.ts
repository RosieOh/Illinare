import { promises as fs } from 'node:fs';
import type { AgentId, ApprovalRequest, MissionEvent, MissionSummary, MissionView } from '@/lib/contracts';
import { appendLine, dataPath, readJson, writeJson } from '@/lib/store/json';
import { applyMissionEvent } from '@/lib/missions/reducer';

const SNAPSHOT_INTERVAL_MS = 1000;
const EVENT_FLUSH_MS = 200;
const MISSION_ID = /^m_[a-z0-9]+$/;

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

/** 승인 미리보기에는 파일 본문이 들어 있다. 화면에는 보여주되 디스크에는 남기지 않는다. */
function withoutPreview(approval: ApprovalRequest): ApprovalRequest {
  const copy = { ...approval };
  delete copy.preview;
  return copy;
}

function persistableEvent(event: MissionEvent): MissionEvent {
  return event.type === 'approval.requested' ? { ...event, approval: withoutPreview(event.approval) } : event;
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
    const view = { ...latest, approvals: latest.approvals.map(withoutPreview) };
    this.chain = this.chain.then(() => writeJson(snapshotPath(this.id), view)).catch(logWriteError);
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

