/**
 * 집중 타이머의 상태 전이. 시작 시각 대신 끝나는 시각을 저장하므로
 * 탭이 느려지거나 화면을 옮기거나 새로고침해도 시간이 어긋나지 않는다.
 */
export type FocusSession = 'focus' | 'short' | 'long';

export const SESSIONS: Record<FocusSession, { label: string; minutes: number }> = {
  focus: { label: '집중', minutes: 25 },
  short: { label: '짧은 휴식', minutes: 5 },
  long: { label: '긴 휴식', minutes: 15 },
};

export const ROUNDS_PER_LONG_BREAK = 4;

export interface FocusState {
  session: FocusSession;
  /** running: endsAt 기준으로 흐름, paused/idle: remainingMs에서 멈춤 */
  status: 'idle' | 'running' | 'paused';
  endsAt: number | null;
  remainingMs: number;
  /** 오늘 끝낸 집중 세션 수 */
  rounds: number;
  /** rounds가 어느 날짜의 값인가 */
  roundsDay: string;
  sound: boolean;
}

export function durationMs(session: FocusSession): number {
  return SESSIONS[session].minutes * 60_000;
}

export function initialFocusState(): FocusState {
  return {
    session: 'focus',
    status: 'idle',
    endsAt: null,
    remainingMs: durationMs('focus'),
    rounds: 0,
    roundsDay: '',
    sound: false,
  };
}

export function remainingAt(state: FocusState, now: number): number {
  if (state.status !== 'running' || state.endsAt === null) return state.remainingMs;
  return Math.min(durationMs(state.session), Math.max(0, state.endsAt - now));
}

export function isFinished(state: FocusState, now: number): boolean {
  return state.status === 'running' && state.endsAt !== null && state.endsAt <= now;
}

export function startFocus(state: FocusState, now: number): FocusState {
  if (state.status === 'running') return state;
  return { ...state, status: 'running', endsAt: now + state.remainingMs };
}

export function pauseFocus(state: FocusState, now: number): FocusState {
  if (state.status !== 'running') return state;
  return { ...state, status: 'paused', endsAt: null, remainingMs: remainingAt(state, now) };
}

export function resetFocus(state: FocusState): FocusState {
  return { ...state, status: 'idle', endsAt: null, remainingMs: durationMs(state.session) };
}

export function switchSession(state: FocusState, session: FocusSession): FocusState {
  return { ...state, session, status: 'idle', endsAt: null, remainingMs: durationMs(session) };
}

/** 날짜가 바뀌었으면 오늘 완료 수를 0으로 되돌린다. */
export function rollDay(state: FocusState, today: string): FocusState {
  if (state.roundsDay === today) return state;
  return { ...state, rounds: 0, roundsDay: today };
}

/** 그 날짜의 완료 수. 날짜가 바뀐 뒤 아직 세션을 안 했으면 어제 값을 보여주지 않는다. */
export function roundsOn(state: FocusState, today: string): number {
  return state.roundsDay === today ? state.rounds : 0;
}

/** 세션을 끝내고 다음 세션을 준비한다. 집중을 끝낸 경우에만 완료 수가 오른다. 건너뛰기는 세지 않는다. */
export function completeSession(state: FocusState, today: string, counted = true): { state: FocusState; finished: FocusSession; next: FocusSession } {
  const rolled = rollDay(state, today);
  const finished = rolled.session;
  const rounds = finished === 'focus' && counted ? rolled.rounds + 1 : rolled.rounds;
  const next: FocusSession =
    finished === 'focus' ? (rounds > 0 && rounds % ROUNDS_PER_LONG_BREAK === 0 ? 'long' : 'short') : 'focus';
  return {
    finished,
    next,
    state: { ...rolled, rounds, session: next, status: 'idle', endsAt: null, remainingMs: durationMs(next) },
  };
}

/** 저장된 값을 믿지 않고 형태를 맞춘다. 손상되면 초기 상태로 시작한다. */
export function reviveFocusState(raw: unknown): FocusState {
  const base = initialFocusState();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const session: FocusSession = r.session === 'short' || r.session === 'long' ? r.session : 'focus';
  const status = r.status === 'running' || r.status === 'paused' ? r.status : 'idle';
  const endsAt = typeof r.endsAt === 'number' && Number.isFinite(r.endsAt) ? r.endsAt : null;
  const max = durationMs(session);
  const remaining = typeof r.remainingMs === 'number' && Number.isFinite(r.remainingMs) ? r.remainingMs : max;
  return {
    session,
    status: status === 'running' && endsAt === null ? 'idle' : status,
    endsAt: status === 'running' ? endsAt : null,
    remainingMs: Math.min(max, Math.max(0, remaining)),
    rounds: typeof r.rounds === 'number' && r.rounds >= 0 ? Math.floor(r.rounds) : 0,
    roundsDay: typeof r.roundsDay === 'string' ? r.roundsDay : '',
    sound: r.sound === true,
  };
}

/** mm:ss */
export function formatTimer(ms: number): string {
  // 올림해야 시작 직후 25:00이 보이고 0:00이 되는 순간 끝난다.
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
