import os from 'node:os';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { run, ok } from './exec';
import { register } from './registry';
import { HOME_DIR } from './paths';

// ─── 시스템 통계 ───────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_system_stats',
  description: '실제 시스템 자원(CPU 부하, 메모리, 디스크)을 조회합니다.',
  risk: 'safe',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '시스템 자원 조회',
  async run() {
    const stats = await collectSystemStats();
    return `CPU 부하(1분): ${stats.cpu1m.toFixed(2)}
CPU 코어: ${stats.cores}
메모리: ${stats.memUsedGB.toFixed(1)}GB / ${stats.memTotalGB.toFixed(1)}GB (${stats.memPct.toFixed(0)}%)
디스크(/): ${stats.diskUsedGB.toFixed(0)}GB / ${stats.diskTotalGB.toFixed(0)}GB (${stats.diskPct.toFixed(0)}%)
가동시간: ${stats.uptimeStr}
호스트: ${stats.hostname}`;
  },
});

// ─── 시간 ─────────────────────────────────────────────────
register<{ timezone?: string }>({
  name: 'get_current_time',
  description: '현재 시각/날짜를 조회합니다 (한국 표준시 기본).',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: '예: Asia/Seoul, UTC' },
    },
    additionalProperties: false,
  },
  summarize: ({ timezone }) => `현재 시각 조회 (${timezone ?? 'Asia/Seoul'})`,
  async run({ timezone }) {
    const tz = timezone ?? 'Asia/Seoul';
    const now = new Date();
    const formatted = now.toLocaleString('ko-KR', {
      timeZone: tz,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return `${formatted} (${tz})`;
  },
});

// ─── 날씨 (wttr.in) ────────────────────────────────────────
register<{ city?: string }>({
  name: 'get_weather',
  description: '특정 도시의 현재 날씨를 조회합니다 (wttr.in 사용, 무료 무인증).',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: { city: { type: 'string', description: '도시명 (영문 권장). 생략 시 IP 기반 자동' } },
    additionalProperties: false,
  },
  summarize: ({ city }) => `날씨 조회: ${city ?? '현재 위치'}`,
  async run({ city }) {
    const target = encodeURIComponent(city ?? '');
    const res = await fetch(`https://wttr.in/${target}?format=j1`, {
      headers: { 'User-Agent': 'curl/8.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`);
    const data = await res.json();
    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!cur) throw new Error('날씨 데이터를 받지 못했습니다');
    const desc = cur.lang_ko?.[0]?.value ?? cur.weatherDesc?.[0]?.value ?? '-';
    const place = area
      ? `${area.areaName?.[0]?.value ?? ''} ${area.country?.[0]?.value ?? ''}`.trim()
      : (city ?? '');
    return `${place}: ${cur.temp_C}°C (체감 ${cur.FeelsLikeC}°C), ${desc}, 습도 ${cur.humidity}%, 풍속 ${cur.windspeedKmph}km/h`;
  },
});

// ─── 스크린샷 ─────────────────────────────────────────────
register<{ filename?: string }>({
  name: 'take_screenshot',
  description: '전체 화면을 캡처해 ~/Desktop/illionaire-screenshots/ 에 저장합니다.',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: { filename: { type: 'string', description: '확장자 없는 파일명. 생략 시 타임스탬프.' } },
    additionalProperties: false,
  },
  summarize: ({ filename }) => `스크린샷 캡처${filename ? `: ${filename}` : ''}`,
  async run({ filename }) {
    const dir = join(HOME_DIR, 'Desktop', 'illionaire-screenshots');
    await fs.mkdir(dir, { recursive: true });
    const name = (filename ?? `shot-${Date.now()}`).replace(/[^\w\-]/g, '_');
    const file = join(dir, `${name}.png`);
    await run('/usr/sbin/screencapture', ['-x', file], { timeoutMs: 8000 });
    return ok(`스크린샷 저장: ${file}`);
  },
});

// ─── 시스템 통계 헬퍼 ───────────────────────────────────────
export interface RealSystemStats {
  cpu1m: number;
  cores: number;
  memUsedGB: number;
  memTotalGB: number;
  memPct: number;
  diskUsedGB: number;
  diskTotalGB: number;
  diskPct: number;
  uptimeStr: string;
  hostname: string;
}

export async function collectSystemStats(): Promise<RealSystemStats> {
  const [load1m] = os.loadavg();
  const cores = os.cpus().length;
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const memUsed = totalBytes - freeBytes;
  const uptime = os.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  // df -k / 로 디스크 사용량 (POSIX 1024블록 단위)
  let diskUsedGB = 0;
  let diskTotalGB = 0;
  try {
    const { stdout } = await run('/bin/df', ['-k', '/'], { timeoutMs: 3000 });
    const lines = stdout.trim().split('\n');
    const parts = lines[lines.length - 1].split(/\s+/);
    const total1k = Number(parts[1]);
    const used1k = Number(parts[2]);
    if (Number.isFinite(total1k) && Number.isFinite(used1k)) {
      diskUsedGB = (used1k * 1024) / 1e9;
      diskTotalGB = (total1k * 1024) / 1e9;
    }
  } catch {
    /* ignore */
  }

  return {
    cpu1m: load1m,
    cores,
    memUsedGB: memUsed / 1e9,
    memTotalGB: totalBytes / 1e9,
    memPct: (memUsed / totalBytes) * 100,
    diskUsedGB,
    diskTotalGB,
    diskPct: diskTotalGB > 0 ? (diskUsedGB / diskTotalGB) * 100 : 0,
    uptimeStr: `${days}일 ${hours}시간 ${mins}분`,
    hostname: os.hostname(),
  };
}
