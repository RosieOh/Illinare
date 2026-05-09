'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useSystemStats, SystemStat } from '@/utils/useSystemStats';

function StatBar({ stat, index }: { stat: SystemStat; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      className="mb-3"
    >
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-secondary tracking-widest uppercase">
          {stat.label}
        </span>
        <span className="text-xs font-mono text-primary tabular-nums">
          {stat.value.toFixed(1)}
          {stat.unit}
        </span>
      </div>
      <div
        className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(stat.value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={stat.label}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: stat.color }}
          initial={{ width: 0 }}
          animate={{ width: `${stat.value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}

export default function SystemStats() {
  const stats = useSystemStats();
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ko-KR', { hour12: false }));
      setDate(
        now.toLocaleDateString('ko-KR', {
          weekday: 'short',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      );
    };
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-center border border-[var(--color-border)] rounded-md p-4 bg-[var(--color-surface-2)]">
        <div
          className="text-2xl font-mono font-medium text-primary tabular-nums tracking-wider"
          aria-label={`현재 시각 ${time}`}
        >
          {time || '00:00:00'}
        </div>
        <div className="text-xs text-muted tracking-wider mt-1">{date}</div>
      </div>

      <div>
        {stats.map((stat, i) => (
          <StatBar key={stat.label} stat={stat} index={i} />
        ))}
      </div>
    </div>
  );
}
