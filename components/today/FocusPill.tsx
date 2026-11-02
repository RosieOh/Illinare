'use client';

import { Pause, Play, Timer } from 'lucide-react';
import { IconButton } from '@/components/glass';
import { formatTimer, SESSIONS } from '@/components/planner/focusLogic';
import { useFocusRemaining, useFocusTimer } from '@/context/FocusContext';

function PillClock({ active }: { active: boolean }) {
  const remaining = useFocusRemaining(active);
  return <span className="text-callout font-semibold text-label tabular-nums">{formatTimer(remaining)}</span>;
}

/** 집중 타이머가 돌고 있을 때만 나타나는 작은 표시. 눌러서 플래너로 간다. */
export function FocusPill({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { state, start, pause } = useFocusTimer();
  if (state.status === 'idle') return null;
  const running = state.status === 'running';
  return (
    <div className="material-thin flex h-10 items-center gap-1 rounded-full pr-1 pl-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${SESSIONS[state.session].label} 타이머, 플래너에서 열기`}
        className="press flex h-8 items-center gap-1.5 rounded-full pr-1 pl-2.5"
      >
        <Timer size={15} className={state.session === 'focus' ? 'text-accent-text' : 'text-success-text'} aria-hidden="true" />
        <span className="text-subhead text-label-2 max-sm:hidden">{SESSIONS[state.session].label}</span>
        <PillClock active={active} />
      </button>
      <IconButton
        icon={running ? Pause : Play}
        size="sm"
        label={running ? '타이머 일시정지' : '타이머 이어서 시작'}
        tooltip={false}
        className="!rounded-full"
        onClick={running ? pause : start}
      />
    </div>
  );
}
