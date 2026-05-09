'use client';

import { useState, useEffect } from 'react';

export interface SystemStat {
  label: string;
  value: number;
  unit: string;
  color: string;
}

interface RawStats {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  memUsedGB: number;
  memTotalGB: number;
  diskUsedGB: number;
  diskTotalGB: number;
  cores: number;
  cpu1m: number;
  uptimeStr: string;
  hostname: string;
}

const FALLBACK: SystemStat[] = [
  { label: 'CPU 사용률', value: 0, unit: '%', color: '#38bdf8' },
  { label: '메모리', value: 0, unit: '%', color: '#0ea5e9' },
  { label: '디스크', value: 0, unit: '%', color: '#34d399' },
  { label: '시스템 부하', value: 0, unit: '%', color: '#fbbf24' },
];

let subscribers: Array<(s: SystemStat[]) => void> = [];
let rawSubscribers: Array<(r: RawStats | null) => void> = [];
let currentStats: SystemStat[] = FALLBACK;
let currentRaw: RawStats | null = null;
let pollStarted = false;

async function fetchOnce() {
  try {
    const res = await fetch('/api/system-stats', { cache: 'no-store' });
    if (!res.ok) return;
    const r: RawStats = await res.json();
    currentRaw = r;
    currentStats = [
      { label: 'CPU 사용률', value: r.cpuPct, unit: '%', color: '#38bdf8' },
      { label: '메모리', value: r.memPct, unit: '%', color: '#0ea5e9' },
      { label: '디스크', value: r.diskPct, unit: '%', color: '#34d399' },
      { label: '시스템 부하', value: Math.min(100, (r.cpu1m / r.cores) * 100), unit: '%', color: '#fbbf24' },
    ];
    subscribers.forEach((fn) => fn(currentStats));
    rawSubscribers.forEach((fn) => fn(currentRaw));
  } catch {
    /* network blip — keep last */
  }
}

function startPoll() {
  if (pollStarted) return;
  pollStarted = true;
  fetchOnce();
  setInterval(fetchOnce, 2000);
}

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStat[]>(currentStats);

  useEffect(() => {
    subscribers.push(setStats);
    startPoll();
    return () => {
      subscribers = subscribers.filter((fn) => fn !== setStats);
    };
  }, []);

  return stats;
}

export function useRawStats() {
  const [raw, setRaw] = useState<RawStats | null>(currentRaw);

  useEffect(() => {
    rawSubscribers.push(setRaw);
    startPoll();
    return () => {
      rawSubscribers = rawSubscribers.filter((fn) => fn !== setRaw);
    };
  }, []);

  return raw;
}
