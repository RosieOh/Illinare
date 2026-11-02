import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { ProcessInfo, SystemSnapshot } from '@/lib/contracts';
import { getPlatform } from './index';
import type { ActivitySample } from './types';

/**
 * 실시간 시스템 수치.
 * CPU는 두 시점의 틱 차이로 계산한다. 프로세스 목록은 비싸므로(Windows는 PowerShell 실행)
 * 마지막 값을 바로 돌려주고 약 3초가 지났으면 뒤에서 새로 고친다.
 */
const ACTIVITY_TTL_MS = 3000;
const BATTERY_TTL_MS = 60000;
const TOP_PROCESSES = 12;

type CpuTicks = { idle: number; total: number };

function readCpuTicks(): CpuTicks[] {
  return os.cpus().map((c) => {
    const { user, nice, sys, idle, irq } = c.times;
    return { idle, total: user + nice + sys + idle + irq };
  });
}

function usagePct(prev: CpuTicks, cur: CpuTicks): number {
  const total = cur.total - prev.total;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - (cur.idle - prev.idle) / total) * 100));
}

let lastCpu: CpuTicks[] | null = null;

async function samplePerCore(): Promise<number[]> {
  if (!lastCpu) {
    lastCpu = readCpuTicks();
    await new Promise((r) => setTimeout(r, 150));
  }
  const cur = readCpuTicks();
  const prev = lastCpu;
  lastCpu = cur;
  return cur.map((c, i) => (prev[i] ? usagePct(prev[i], c) : 0));
}

// ─── 프로세스, 네트워크 ───────────────────────────────────────
interface ActivityState {
  at: number;
  sample: ActivitySample;
  processes: ProcessInfo[];
  network: { rxBps: number; txBps: number } | null;
}

let activity: ActivityState | null = null;
let refreshing: Promise<ActivityState> | null = null;

/** 이름별로 묶는다. 브라우저처럼 프로세스가 수십 개인 앱을 하나로 보여주기 위해서다. */
export function summarizeProcesses(
  sample: ActivitySample,
  prev: ActivitySample | null,
  elapsedSec: number,
  cores: number,
  limit: number
): ProcessInfo[] {
  const previous = new Map(prev?.processes.map((p) => [p.pid, p]));
  const byName = new Map<string, ProcessInfo & { topCpu: number }>();
  for (const p of sample.processes) {
    let cpu = p.cpuPct ?? 0;
    if (p.cpuSec !== undefined) {
      const before = previous.get(p.pid)?.cpuSec;
      cpu =
        before !== undefined && elapsedSec > 0
          ? Math.max(0, ((p.cpuSec - before) / elapsedSec / cores) * 100)
          : 0;
    }
    const entry = byName.get(p.name);
    if (entry) {
      entry.cpuPct += cpu;
      entry.memMb += p.memMb;
      if (cpu > entry.topCpu) {
        entry.topCpu = cpu;
        entry.pid = p.pid;
      }
    } else {
      byName.set(p.name, { pid: p.pid, name: p.name, cpuPct: cpu, memMb: p.memMb, topCpu: cpu });
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.cpuPct - a.cpuPct || b.memMb - a.memMb)
    .slice(0, limit)
    .map(({ pid, name, cpuPct, memMb }) => ({
      pid,
      name,
      cpuPct: Math.round(cpuPct * 10) / 10,
      memMb: Math.round(memMb),
    }));
}

function networkRate(
  sample: ActivitySample,
  prev: ActivityState | null,
  elapsedSec: number
): ActivityState['network'] {
  if (!prev || elapsedSec <= 0) return null;
  const { rxBytes, txBytes } = sample;
  const { rxBytes: prevRx, txBytes: prevTx } = prev.sample;
  if (rxBytes === null || txBytes === null || prevRx === null || prevTx === null) return null;
  return {
    rxBps: Math.max(0, (rxBytes - prevRx) / elapsedSec),
    txBps: Math.max(0, (txBytes - prevTx) / elapsedSec),
  };
}

function refreshActivity(limit = TOP_PROCESSES): Promise<ActivityState> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const sample = await getPlatform().sampleActivity();
    const now = Date.now();
    const prev = activity;
    const elapsedSec = prev ? (now - prev.at) / 1000 : 0;
    activity = {
      at: now,
      sample,
      network: networkRate(sample, prev, elapsedSec),
      processes: summarizeProcesses(sample, prev?.sample ?? null, elapsedSec, os.cpus().length, limit),
    };
    return activity;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * 프로세스 표본은 OS에 따라 몇 초가 걸린다. CPU와 메모리 응답을 붙잡지 않도록 뒤에서 채우고,
 * 첫 응답의 processes는 비어 있다.
 */
function currentActivity(): ActivityState | null {
  if (!activity || Date.now() - activity.at > ACTIVITY_TTL_MS) void refreshActivity().catch(() => undefined);
  return activity;
}

/** 도구용: CPU 사용률이 의미 있도록 두 표본 이상 확보한 뒤 돌려준다. */
export async function getTopProcesses(limit = 15): Promise<ProcessInfo[]> {
  if (!activity || Date.now() - activity.at > 60000) {
    await refreshActivity(limit);
    await new Promise((r) => setTimeout(r, 500));
  }
  const state = await refreshActivity(limit);
  return state.processes.slice(0, limit);
}

let batteryCache: { at: number; value: SystemSnapshot['battery'] } | null = null;

let batteryRefreshing = false;

/** 배터리도 뒤에서 갱신한다. 아직 읽지 못했으면 없는 값으로 둔다. */
function currentBattery(): SystemSnapshot['battery'] {
  if (!batteryRefreshing && (!batteryCache || Date.now() - batteryCache.at >= BATTERY_TTL_MS)) {
    batteryRefreshing = true;
    void getPlatform()
      .battery()
      .catch(() => null)
      .then((value) => {
        batteryCache = { at: Date.now(), value };
        batteryRefreshing = false;
      });
  }
  return batteryCache?.value ?? null;
}

async function diskUsage(): Promise<{ usedGb: number; totalGb: number }> {
  try {
    // 홈 디렉터리가 있는 볼륨을 잰다 (macOS APFS의 / 는 읽기 전용 시스템 볼륨이다).
    const s = await fs.statfs(os.homedir());
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    return { usedGb: (total - free) / 1e9, totalGb: total / 1e9 };
  } catch {
    return { usedGb: 0, totalGb: 0 };
  }
}

async function memoryUsage(): Promise<{ used: number; total: number }> {
  const total = os.totalmem();
  let used: number | null = null;
  try {
    used = await getPlatform().memoryUsedBytes();
  } catch {
    used = null;
  }
  return { used: used ?? total - os.freemem(), total };
}

export async function collectSnapshot(): Promise<SystemSnapshot> {
  const [perCore, disk, memory] = await Promise.all([samplePerCore(), diskUsage(), memoryUsage()]);
  const battery = currentBattery();
  const act = currentActivity();
  const cpuPct = perCore.length ? perCore.reduce((a, b) => a + b, 0) / perCore.length : 0;
  return {
    at: Date.now(),
    cpuPct,
    perCore,
    cpuModel: os.cpus()[0]?.model.trim() ?? '',
    memPct: (memory.used / memory.total) * 100,
    memUsedGb: memory.used / 1e9,
    memTotalGb: memory.total / 1e9,
    diskPct: disk.totalGb > 0 ? (disk.usedGb / disk.totalGb) * 100 : 0,
    diskUsedGb: disk.usedGb,
    diskTotalGb: disk.totalGb,
    // Windows의 os.loadavg()는 항상 0이므로 없는 값으로 표시한다.
    load1m: process.platform === 'win32' ? null : os.loadavg()[0],
    uptimeSec: os.uptime(),
    hostname: os.hostname(),
    platform: getPlatform().osLabel(),
    battery,
    network: act?.network ?? null,
    processes: act?.processes ?? [],
  };
}
