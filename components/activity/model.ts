import type { AgentId, AuditEntry, ToolRisk } from '@/lib/contracts';

/** 활동 기록의 필터와 묶음. React와 분리해 단위 테스트한다. */
export interface ActivityFilters {
  query: string;
  status: AuditEntry['status'] | 'all';
  agent: AgentId | 'all';
  risk: ToolRisk | 'all';
}

export const NO_FILTERS: ActivityFilters = { query: '', status: 'all', agent: 'all', risk: 'all' };

export function isFiltering(f: ActivityFilters): boolean {
  return Boolean(f.query.trim()) || f.status !== 'all' || f.agent !== 'all' || f.risk !== 'all';
}

export function filterEntries(entries: AuditEntry[], f: ActivityFilters): AuditEntry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.status !== 'all' && e.status !== f.status) return false;
    if (f.agent !== 'all' && e.agent !== f.agent) return false;
    if (f.risk !== 'all' && e.risk !== f.risk) return false;
    if (q && !`${e.summary} ${e.tool} ${e.result ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export interface MissionGroup {
  /** 미션 밖에서 일어난 작업은 null */
  missionId: string | null;
  entries: AuditEntry[];
}

export interface DayGroup {
  key: string;
  label: string;
  groups: MissionGroup[];
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function dayLabel(at: number, now: number): string {
  const key = dayKey(at);
  if (key === dayKey(now)) return '오늘';
  if (key === dayKey(now - 86_400_000)) return '어제';
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('ko-KR', {
    year: sameYear ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/**
 * 최신순 목록을 날짜로 묶고, 날짜 안에서 미션별로 묶는다.
 * 미션 순서는 그날 가장 최근 활동 순서이고 묶음 안의 순서는 그대로 최신순이다.
 */
export function groupEntries(entries: AuditEntry[], now: number): DayGroup[] {
  const days: DayGroup[] = [];
  const indexes = new Map<string, Map<string | null, MissionGroup>>();
  for (const entry of entries) {
    const key = dayKey(entry.at);
    let missions = indexes.get(key);
    if (!missions) {
      missions = new Map();
      indexes.set(key, missions);
      days.push({ key, label: dayLabel(entry.at, now), groups: [] });
    }
    const missionId = entry.missionId ?? null;
    let group = missions.get(missionId);
    if (!group) {
      group = { missionId, entries: [] };
      missions.set(missionId, group);
      days[days.length - 1].groups.push(group);
    }
    group.entries.push(entry);
  }
  return days;
}

export const STATUS_LABEL: Record<AuditEntry['status'], string> = {
  ok: '실행됨',
  error: '오류',
  denied: '거부함',
  blocked: '차단됨',
};

export const APPROVED_LABEL: Record<AuditEntry['approvedBy'], string> = {
  auto: '자동 실행',
  user: '직접 승인',
  policy: '정책',
};

export const RISK_LABEL: Record<ToolRisk, string> = {
  safe: '안전',
  confirm: '변경',
  danger: '위험',
};
