import { collectSystemStats } from '@/lib/tools/data';
import os from 'node:os';

export const dynamic = 'force-dynamic';

let lastCpuTimes: { idle: number; total: number } | null = null;

function readCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

export async function GET() {
  try {
    const stats = await collectSystemStats();
    // CPU 사용률 — 두 샘플 사이의 차이로 계산
    const now = readCpuTimes();
    let cpuPct = 0;
    if (lastCpuTimes) {
      const idleDelta = now.idle - lastCpuTimes.idle;
      const totalDelta = now.total - lastCpuTimes.total;
      if (totalDelta > 0) {
        cpuPct = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
      }
    }
    lastCpuTimes = now;

    return Response.json({
      cpuPct,
      memPct: stats.memPct,
      memUsedGB: stats.memUsedGB,
      memTotalGB: stats.memTotalGB,
      diskPct: stats.diskPct,
      diskUsedGB: stats.diskUsedGB,
      diskTotalGB: stats.diskTotalGB,
      cores: stats.cores,
      cpu1m: stats.cpu1m,
      uptimeStr: stats.uptimeStr,
      hostname: stats.hostname,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
