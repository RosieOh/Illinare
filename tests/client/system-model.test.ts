import { describe, expect, it } from 'vitest';
import type { AuditEntry, SystemSnapshot } from '@/lib/contracts';
import {
  filterEntries,
  groupEntries,
  isFiltering,
  NO_FILTERS,
} from '@/components/activity/model';
import {
  cpuSummary,
  formatMb,
  formatRate,
  formatUptime,
  HISTORY_MS,
  meterTone,
  nearestIndex,
  niceCeiling,
  pushSample,
  slowGoal,
  splitAtGaps,
  statusLine,
  topBy,
  type Sample,
} from '@/components/system/model';

function snapshot(patch: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    at: 1_000_000,
    cpuPct: 20,
    perCore: [10, 30],
    cpuModel: 'Test CPU',
    memPct: 40,
    memUsedGb: 6.4,
    memTotalGb: 16,
    diskPct: 50,
    diskUsedGb: 250,
    diskTotalGb: 500,
    load1m: null,
    uptimeSec: 3600,
    hostname: 'host',
    platform: 'Windows 11',
    battery: null,
    network: null,
    processes: [],
    ...patch,
  };
}

const busy = (count: number): Sample[] =>
  Array.from({ length: count }, (_, i) => ({ at: i * 2000, cpu: 97, rx: null, tx: null }));

describe('system history', () => {
  it('keeps only samples inside the five-minute window', () => {
    const old: Sample = { at: 0, cpu: 1, rx: null, tx: null };
    const recent: Sample = { at: HISTORY_MS, cpu: 2, rx: null, tx: null };
    const next = pushSample([old, recent], snapshot({ at: HISTORY_MS + 10, cpuPct: 3 }));
    expect(next.map((s) => s.cpu)).toEqual([2, 3]);
  });

  it('records null network as null, never zero', () => {
    const [sample] = pushSample([], snapshot({ network: null }));
    expect(sample.rx).toBeNull();
    expect(sample.tx).toBeNull();
  });

  it('breaks the line where polling stopped', () => {
    const points = [0, 2000, 4000, 60_000, 62_000].map((at) => ({ at, value: 1 }));
    expect(splitAtGaps(points).map((s) => s.length)).toEqual([3, 2]);
  });

  it('finds the nearest sample', () => {
    const points = [0, 2000, 4000].map((at) => ({ at, value: 1 }));
    expect(nearestIndex(points, 2900)).toBe(1);
    expect(nearestIndex(points, 3100)).toBe(2);
    expect(nearestIndex([], 10)).toBe(-1);
  });
});

describe('cpuSummary', () => {
  it('does not claim five minutes until it has measured them', () => {
    expect(cpuSummary([])).toBeNull();
    const short = cpuSummary(busy(3));
    expect(short).toMatchObject({ avg: 97, max: 97, label: '이 화면을 연 뒤' });
    expect(cpuSummary(busy(150))?.label).toBe('최근 5분');
  });
});

describe('statusLine', () => {
  it('stays undramatic under the thresholds', () => {
    expect(statusLine(snapshot(), [])).toEqual({ tone: 'neutral', text: '눈에 띄는 문제는 없어요.' });
  });

  it('calls out nearly full memory', () => {
    expect(statusLine(snapshot({ memPct: 92 }), [])).toMatchObject({ tone: 'danger', text: '메모리가 거의 찼어요.' });
  });

  it('needs sustained CPU, not one spike', () => {
    expect(statusLine(snapshot({ cpuPct: 100 }), []).tone).toBe('neutral');
    const line = statusLine(
      snapshot({ cpuPct: 97, processes: [{ pid: 1, name: 'node', cpuPct: 80, memMb: 10 }] }),
      busy(15)
    );
    expect(line.tone).toBe('warning');
    expect(line.text).toContain('node');
  });

  it('warns about a low battery only when not charging', () => {
    expect(statusLine(snapshot({ battery: { percent: 8, charging: true } }), []).tone).toBe('neutral');
    expect(statusLine(snapshot({ battery: { percent: 8, charging: false } }), []).tone).toBe('danger');
  });
});

describe('slowGoal', () => {
  it('quotes only measured values and asks not to quit apps', () => {
    const goal = slowGoal(
      snapshot({
        processes: [
          { pid: 1, name: 'chrome', cpuPct: 12.34, memMb: 2048 },
          { pid: 2, name: 'code', cpuPct: 1, memMb: 512 },
        ],
      })
    );
    expect(goal).toContain('CPU 20%');
    expect(goal).toContain('chrome: CPU 12.3%, 메모리 2.0 GB');
    expect(goal.match(/- chrome/g)).toHaveLength(1);
    expect(goal).toContain('직접 종료하지는 말아');
  });
});

describe('formatting', () => {
  it('formats rates, memory and uptime', () => {
    expect(formatRate(500)).toBe('500 B/s');
    expect(formatRate(2048)).toBe('2 KB/s');
    expect(formatRate(3 * 1024 ** 2)).toBe('3.0 MB/s');
    expect(formatMb(810)).toBe('810 MB');
    expect(formatMb(4709)).toBe('4.6 GB');
    expect(formatUptime(90_000)).toBe('1일 1시간');
    expect(formatUptime(120)).toBe('2분');
  });

  it('rounds axis ceilings up and survives empty input', () => {
    expect(niceCeiling(0)).toBe(1024);
    expect(niceCeiling(1500)).toBe(2048);
    expect(niceCeiling(3 * 1024 ** 2)).toBe(5 * 1024 ** 2);
  });

  it('maps meter severity', () => {
    expect(meterTone(50)).toBe('accent');
    expect(meterTone(80)).toBe('warning');
    expect(meterTone(92)).toBe('danger');
  });

  it('sorts processes with a stable tiebreak and limits rows', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ pid: i, name: `p${i}`, cpuPct: 0, memMb: i }));
    const top = topBy(rows, 'cpuPct');
    expect(top).toHaveLength(15);
    expect(top[0].name).toBe('p19');
  });
});

// ─── 활동 기록 ───────────────────────────────────────────────
function audit(patch: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'a',
    at: new Date(2026, 10, 2, 12).getTime(),
    tool: 'read_file',
    summary: '파일 읽기',
    risk: 'safe',
    status: 'ok',
    approvedBy: 'auto',
    undoable: false,
    ...patch,
  };
}

describe('activity filters', () => {
  const entries = [
    audit({ id: '1', status: 'ok', agent: 'archivist', risk: 'safe', summary: '보고서 읽기' }),
    audit({ id: '2', status: 'denied', agent: 'operator', risk: 'danger', tool: 'quit_app', summary: '앱 종료' }),
    audit({ id: '3', status: 'ok', agent: 'writer', risk: 'confirm', result: '노트 저장 완료' }),
  ];

  it('filters by each facet and by search over summary, tool and result', () => {
    expect(filterEntries(entries, { ...NO_FILTERS, status: 'denied' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { ...NO_FILTERS, agent: 'writer' }).map((e) => e.id)).toEqual(['3']);
    expect(filterEntries(entries, { ...NO_FILTERS, risk: 'danger' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { ...NO_FILTERS, query: 'QUIT' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { ...NO_FILTERS, query: '저장 완료' }).map((e) => e.id)).toEqual(['3']);
    expect(filterEntries(entries, NO_FILTERS)).toHaveLength(3);
  });

  it('knows whether any filter is on', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, query: '  ' })).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, risk: 'safe' })).toBe(true);
  });
});

describe('activity grouping', () => {
  const now = new Date(2026, 10, 2, 18).getTime();

  it('groups by day then mission, newest first, keeping order inside', () => {
    const entries = [
      audit({ id: '1', at: new Date(2026, 10, 2, 15).getTime(), missionId: 'm1' }),
      audit({ id: '2', at: new Date(2026, 10, 2, 14).getTime(), missionId: 'm2' }),
      audit({ id: '3', at: new Date(2026, 10, 2, 13).getTime(), missionId: 'm1' }),
      audit({ id: '4', at: new Date(2026, 10, 1, 9).getTime() }),
      audit({ id: '5', at: new Date(2026, 9, 20, 9).getTime(), missionId: 'm1' }),
    ];
    const days = groupEntries(entries, now);
    expect(days.map((d) => d.label.slice(0, 2))).toEqual(['오늘', '어제', '10']);
    expect(days[0].groups.map((g) => g.missionId)).toEqual(['m1', 'm2']);
    expect(days[0].groups[0].entries.map((e) => e.id)).toEqual(['1', '3']);
    expect(days[1].groups[0].missionId).toBeNull();
  });
});
