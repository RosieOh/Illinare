import type { ProcessInfo, SystemSnapshot } from '@/lib/contracts';

/** 시스템 뷰의 계산 로직. React와 분리해 단위 테스트한다. */
export const SAMPLE_INTERVAL_MS = 2000;
export const HISTORY_MS = 5 * 60 * 1000;
const MIN_WINDOW_MS = 60 * 1000;

/** 차트 폭을 모은 표본 길이에 맞춘다. 막 열었을 때 오른쪽 끝에 점 몇 개만 몰리지 않게 한다. */
export function chartWindowMs(history: { at: number }[], end: number): number {
  const first = history[0]?.at ?? end;
  return Math.min(HISTORY_MS, Math.max(MIN_WINDOW_MS, (end - first) * 1.1));
}

export interface Sample {
  at: number;
  cpu: number;
  rx: number | null;
  tx: number | null;
}

export interface Point {
  at: number;
  value: number;
}

/** 새 표본을 넣고 보관 기간을 넘은 표본을 버린다. 이전 배열은 건드리지 않는다. */
export function pushSample(history: Sample[], snapshot: SystemSnapshot): Sample[] {
  const sample: Sample = {
    at: snapshot.at,
    cpu: snapshot.cpuPct,
    rx: snapshot.network?.rxBps ?? null,
    tx: snapshot.network?.txBps ?? null,
  };
  const cutoff = snapshot.at - HISTORY_MS;
  return [...history.filter((s) => s.at >= cutoff && s.at < snapshot.at), sample];
}

/**
 * 측정이 멈춘 구간(다른 화면을 보던 시간)에 선을 잇지 않도록 나눈다.
 * 기기가 바쁘면 응답이 십수 초씩 걸리기도 하므로 그 정도는 이어서 그린다.
 */
export function splitAtGaps(points: Point[], maxGapMs = 30_000): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (last && point.at - last.at > maxGapMs) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

export function nearestIndex(points: Point[], at: number): number {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((p, i) => {
    const distance = Math.abs(p.at - at);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

export function cpuSummary(history: Sample[]): { avg: number; max: number; label: string } | null {
  if (!history.length) return null;
  const sum = history.reduce((acc, s) => acc + s.cpu, 0);
  const span = history[history.length - 1].at - history[0].at;
  return {
    avg: sum / history.length,
    max: Math.max(...history.map((s) => s.cpu)),
    // 아직 5분을 채우지 못했으면 실제로 잰 구간만 말한다.
    label: span >= HISTORY_MS - 30_000 ? '최근 5분' : '이 화면을 연 뒤',
  };
}

export type StatusTone = 'neutral' | 'warning' | 'danger';

/** CPU를 "계속" 쓴다고 말하는 기준 시간 */
const SUSTAINED_MS = 30_000;

export function meterTone(pct: number): 'accent' | 'warning' | 'danger' {
  if (pct >= 92) return 'danger';
  if (pct >= 80) return 'warning';
  return 'accent';
}

/** 실제 측정값과 임계값으로만 만드는 상태 문장. 임계값을 넘지 않으면 극적인 말을 하지 않는다. */
export function statusLine(snapshot: SystemSnapshot, history: Sample[]): { tone: StatusTone; text: string } {
  // 표본 수가 아니라 시간으로 자른다. 오늘 화면은 시스템 화면보다 드물게 측정한다.
  const recent = history.filter((s) => s.at > snapshot.at - SUSTAINED_MS);
  const sustainedCpu = recent.length >= 5 ? recent.reduce((a, s) => a + s.cpu, 0) / recent.length : snapshot.cpuPct;
  const battery = snapshot.battery;
  if (snapshot.diskPct >= 95) {
    const free = Math.max(0, snapshot.diskTotalGb - snapshot.diskUsedGb);
    return { tone: 'danger', text: `디스크 공간이 거의 없어요. ${formatGb(free)} 남았어요.` };
  }
  if (snapshot.memPct >= 92) return { tone: 'danger', text: '메모리가 거의 찼어요.' };
  if (battery && !battery.charging && battery.percent <= 10) {
    return { tone: 'danger', text: `배터리가 ${Math.round(battery.percent)}% 남았어요.` };
  }
  if (recent.length >= 5 && sustainedCpu >= 90) {
    const top = topBy(snapshot.processes, 'cpuPct')[0];
    const who = top && top.cpuPct > 0 ? ` ${top.name}이(가) 가장 많이 쓰고 있어요.` : '';
    return { tone: 'warning', text: `최근 30초 동안 CPU를 거의 다 쓰고 있어요.${who}` };
  }
  if (snapshot.memPct >= 80) return { tone: 'warning', text: '메모리를 많이 쓰고 있어요.' };
  if (snapshot.diskPct >= 85) return { tone: 'warning', text: '디스크가 점점 차고 있어요.' };
  return { tone: 'neutral', text: '눈에 띄는 문제는 없어요.' };
}

export type ProcessSort = 'cpu' | 'mem';

export function topBy(processes: ProcessInfo[], key: 'cpuPct' | 'memMb', limit = 15): ProcessInfo[] {
  const other = key === 'cpuPct' ? 'memMb' : 'cpuPct';
  return [...processes].sort((a, b) => b[key] - a[key] || b[other] - a[other]).slice(0, limit);
}

/** "왜 느린지" 미션의 목표. 지금 측정한 값만 넣는다. */
export function slowGoal(snapshot: SystemSnapshot): string {
  const lines = [
    '지금 컴퓨터가 왜 느린지 알아봐 줘.',
    '',
    `측정값: CPU ${snapshot.cpuPct.toFixed(0)}%, 메모리 ${snapshot.memPct.toFixed(0)}% (${formatGb(snapshot.memUsedGb)} / ${formatGb(snapshot.memTotalGb)}), 디스크 ${snapshot.diskPct.toFixed(0)}%`,
  ];
  const cpuTop = topBy(snapshot.processes, 'cpuPct', 5);
  const memTop = topBy(snapshot.processes, 'memMb', 5);
  const seen = new Set<string>();
  const rows = [...cpuTop, ...memTop].filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  if (rows.length) {
    lines.push('상위 프로세스:');
    for (const p of rows) lines.push(`- ${p.name}: CPU ${p.cpuPct.toFixed(1)}%, 메모리 ${formatMb(p.memMb)}`);
  }
  lines.push('', '원인으로 보이는 것과 내가 할 수 있는 조치를 알려 줘. 앱을 직접 종료하지는 말아 줘.');
  return lines.join('\n');
}

// ─── 포맷 ────────────────────────────────────────────────────
export function formatGb(gb: number): string {
  if (gb >= 100) return `${gb.toFixed(0)} GB`;
  return `${gb.toFixed(1)} GB`;
}

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatRate(bytesPerSec: number): string {
  const v = Math.max(0, bytesPerSec);
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB/s`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB/s`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB/s`;
  return `${Math.round(v)} B/s`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

/** 축의 윗값을 1·2·5 단위로 올린다. 값이 없어도 0이 되지 않는다. */
export function niceCeiling(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1024;
  const pow = 1024 ** Math.floor(Math.log(max) / Math.log(1024));
  const scaled = max / pow;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => scaled <= s) ?? 1024;
  return step * pow;
}
