'use client';

import { Bell, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Button, IconButton, Material, Segmented, type SegmentedOption } from '@/components/glass';
import { useFocusRemaining, useFocusTimer } from '@/context/FocusContext';
import { durationMs, formatTimer, ROUNDS_PER_LONG_BREAK, roundsOn, SESSIONS, type FocusSession } from './focusLogic';

const OPTIONS: SegmentedOption<FocusSession>[] = [
  { value: 'focus', label: SESSIONS.focus.label },
  { value: 'short', label: SESSIONS.short.label },
  { value: 'long', label: SESSIONS.long.label },
];

const RADIUS = 92;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 숫자와 링만 1초마다 다시 그린다. 타이머에서는 링이 곧 내용이다. */
function FocusClock({ active }: { active: boolean }) {
  const { state } = useFocusTimer();
  const remaining = useFocusRemaining(active);
  const total = durationMs(state.session);
  const progress = 1 - remaining / total;
  const minutes = Math.ceil(remaining / 60_000);
  const color = state.session === 'focus' ? 'var(--accent)' : 'var(--success)';
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[208px] [@media(max-height:860px)]:max-w-[148px]">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="var(--fill-2)" strokeWidth="9" />
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          style={{ transition: state.status === 'running' ? 'stroke-dashoffset 1s linear' : 'stroke-dashoffset .25s ease-out' }}
        />
      </svg>
      <div
        role="timer"
        aria-label={`${SESSIONS[state.session].label}, 약 ${minutes}분 남음`}
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span className="text-[3.25rem] leading-none [@media(max-height:860px)]:text-[2.25rem] font-semibold tracking-[-0.03em] text-label tabular-nums">
          {formatTimer(remaining)}
        </span>
        <span className="mt-1.5 text-subhead text-label-2 [@media(max-height:860px)]:mt-0.5 [@media(max-height:860px)]:text-footnote">
          {state.status === 'paused' ? '일시정지' : SESSIONS[state.session].label}
        </span>
      </div>
    </div>
  );
}

export function FocusPane({ active, today }: { active: boolean; today: string }) {
  const { state, start, pause, reset, skip, selectSession, setSound, notifyPrompt, acceptNotify, dismissNotify } = useFocusTimer();
  const running = state.status === 'running';
  const rounds = roundsOn(state, today);
  const untilLong = ROUNDS_PER_LONG_BREAK - (rounds % ROUNDS_PER_LONG_BREAK);

  return (
    <Material as="section" aria-label="집중 타이머" className="p-3.5">
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-title3 text-label">집중</h2>
        <span className="flex items-center gap-1">
          <span className="text-footnote text-label-2 tabular-nums">오늘 {rounds}회</span>
          <IconButton
            icon={state.sound ? Volume2 : VolumeX}
            size="sm"
            label={state.sound ? '끝날 때 소리 끄기' : '끝날 때 소리 켜기'}
            aria-pressed={state.sound}
            onClick={() => setSound(!state.sound)}
          />
        </span>
      </header>

      <Segmented options={OPTIONS} value={state.session} onChange={selectSession} label="세션 종류" size="sm" fullWidth />

      <div className="mt-3.5">
        <FocusClock active={active} />
      </div>

      <div className="mt-3.5 flex items-center justify-center gap-2">
        <IconButton icon={RotateCcw} label="처음부터" variant="filled" onClick={reset} />
        <Button variant="primary" size="md" icon={running ? Pause : Play} onClick={running ? pause : start} className="min-w-[116px]">
          {running ? '일시정지' : state.status === 'paused' ? '이어서' : '시작'}
        </Button>
        <IconButton icon={SkipForward} label="다음 세션으로 건너뛰기" variant="filled" onClick={skip} />
      </div>

      <p className="mt-2.5 text-center text-footnote text-label-2">
        {state.session === 'focus' ? `집중 ${untilLong}번 더 하면 긴 휴식이에요` : '쉬고 나면 다시 집중으로 돌아와요'}
      </p>

      {notifyPrompt && (
        <div role="status" className="mt-3 rounded-[14px] bg-fill-4 p-3">
          <p className="flex items-start gap-2 text-subhead text-label">
            <Bell size={14} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
            다른 창에서 일하는 동안 세션이 끝나면 알림으로 알려 드릴까요?
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="plain" onClick={dismissNotify}>
              괜찮아요
            </Button>
            <Button size="sm" onClick={acceptNotify}>
              알림 켜기
            </Button>
          </div>
        </div>
      )}
    </Material>
  );
}
