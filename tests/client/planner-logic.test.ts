import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Task } from '@/lib/contracts';
import {
  buildAgenda,
  findOverlaps,
  filterTasks,
  nowMarkerIndex,
  sortEvents,
  sortTasks,
  taskCounts,
  untilLabel,
} from '@/components/planner/logic';
import {
  completeSession,
  durationMs,
  formatTimer,
  initialFocusState,
  isFinished,
  pauseFocus,
  remainingAt,
  resetFocus,
  reviveFocusState,
  rollDay,
  roundsOn,
  startFocus,
  switchSession,
} from '@/components/planner/focusLogic';

const TODAY = '2026-11-02';

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, text: id, done: false, priority: 'normal', createdAt: 1, ...patch };
}

function event(id: string, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, date: TODAY, kind: 'work', done: false, createdAt: 1, ...patch };
}

const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);

describe('할 일 필터', () => {
  const tasks = [
    task('overdue', { due: '2026-11-01' }),
    task('today', { due: TODAY }),
    task('tomorrow', { due: '2026-11-03' }),
    task('none'),
    task('done', { done: true, due: TODAY }),
  ];

  it('오늘은 지난 것과 오늘 기한의 안 끝낸 일이다', () => {
    expect(ids(filterTasks(tasks, 'today', TODAY))).toEqual(['overdue', 'today']);
  });
  it('예정은 내일 이후의 안 끝낸 일이다', () => {
    expect(ids(filterTasks(tasks, 'upcoming', TODAY))).toEqual(['tomorrow']);
  });
  it('완료와 전체', () => {
    expect(ids(filterTasks(tasks, 'done', TODAY))).toEqual(['done']);
    expect(filterTasks(tasks, 'all', TODAY)).toHaveLength(5);
  });
  it('개수를 센다', () => {
    expect(taskCounts(tasks, TODAY)).toEqual({ today: 2, upcoming: 1, all: 5, done: 1 });
  });
});

describe('할 일 정렬', () => {
  it('스마트 정렬: 지난 것, 오늘, 높음, 기한, 나머지, 끝낸 것', () => {
    const list = [
      task('later', { due: '2026-11-20' }),
      task('done', { done: true, completedAt: 5, due: '2026-10-01' }),
      task('plain'),
      task('high', { priority: 'high' }),
      task('today', { due: TODAY }),
      task('overdue', { due: '2026-10-31' }),
    ];
    expect(ids(sortTasks(list, 'smart', TODAY))).toEqual(['overdue', 'today', 'high', 'later', 'plain', 'done']);
  });

  it('기한순은 기한 없는 일을 뒤로 보낸다', () => {
    const list = [task('none'), task('b', { due: '2026-12-01' }), task('a', { due: '2026-11-05' })];
    expect(ids(sortTasks(list, 'due', TODAY))).toEqual(['a', 'b', 'none']);
  });

  it('우선순위순', () => {
    const list = [task('low', { priority: 'low' }), task('n'), task('high', { priority: 'high' })];
    expect(ids(sortTasks(list, 'priority', TODAY))).toEqual(['high', 'n', 'low']);
  });

  it('최신순, 원본을 바꾸지 않는다', () => {
    const list = [task('old', { createdAt: 1 }), task('new', { createdAt: 9 })];
    expect(ids(sortTasks(list, 'recent', TODAY))).toEqual(['new', 'old']);
    expect(ids(list)).toEqual(['old', 'new']);
  });
});

describe('일정 겹침', () => {
  it('시간이 겹치는 일정만 찾는다', () => {
    const overlaps = findOverlaps([
      event('a', { time: '09:00', durationMin: 60 }),
      event('b', { time: '09:30', durationMin: 30 }),
      event('c', { time: '10:00', durationMin: 30 }),
      event('all-day'),
      event('other-day', { date: '2026-11-03', time: '09:15' }),
    ]);
    expect([...overlaps].sort()).toEqual(['a', 'b']);
  });

  it('긴 일정 안에 든 일정이 여럿이면 모두 표시한다', () => {
    const overlaps = findOverlaps([
      event('long', { time: '09:00', durationMin: 240 }),
      event('x', { time: '10:00', durationMin: 30 }),
      event('y', { time: '11:00', durationMin: 30 }),
    ]);
    expect([...overlaps].sort()).toEqual(['long', 'x', 'y']);
  });

  it('끝나는 시각에 시작하면 겹치지 않는다', () => {
    expect(
      findOverlaps([event('a', { time: '09:00', durationMin: 30 }), event('b', { time: '09:30', durationMin: 30 })]).size
    ).toBe(0);
  });

  it('소요 시간이 없으면 1시간으로 본다', () => {
    expect(findOverlaps([event('a', { time: '09:00' }), event('b', { time: '09:59' })]).size).toBe(2);
  });
});

describe('오늘 안건', () => {
  const list = [
    event('b', { time: '14:00', durationMin: 60 }),
    event('a', { time: '09:00', durationMin: 60 }),
    event('all'),
    event('c', { time: '16:00' }),
  ];

  it('종일 일정을 먼저 두고 시간순으로 정렬한다', () => {
    expect(ids(sortEvents(list))).toEqual(['all', 'a', 'b', 'c']);
  });

  it('지금 기준으로 단계를 나눈다', () => {
    const at1430 = buildAgenda(list, 14 * 60 + 30);
    expect(at1430.map((x) => x.phase)).toEqual(['allDay', 'past', 'now', 'next']);
    const at1000 = buildAgenda(list, 10 * 60);
    expect(at1000.map((x) => x.phase)).toEqual(['allDay', 'past', 'next', 'later']);
  });

  it('완료 표시한 일정은 지난 것으로 본다', () => {
    const items = buildAgenda([event('x', { time: '20:00', done: true })], 9 * 60);
    expect(items[0].phase).toBe('past');
  });

  it('지금 표시선은 이미 시작한 일정 다음에 놓인다', () => {
    const at0800 = buildAgenda(list, 8 * 60);
    expect(nowMarkerIndex(at0800, 8 * 60)).toBe(1); // 종일 일정 다음
    const at1500 = buildAgenda(list, 15 * 60);
    expect(nowMarkerIndex(at1500, 15 * 60)).toBe(3);
    const at2300 = buildAgenda(list, 23 * 60);
    expect(nowMarkerIndex(at2300, 23 * 60)).toBe(4);
  });

  it('남은 시간을 말로 표현한다', () => {
    expect(untilLabel(0)).toBe('곧');
    expect(untilLabel(45)).toBe('45분 뒤');
    expect(untilLabel(60)).toBe('1시간 뒤');
    expect(untilLabel(90)).toBe('1시간 30분 뒤');
  });
});

describe('집중 타이머', () => {
  const T0 = 1_000_000;

  it('끝나는 시각 기준으로 남은 시간을 계산한다', () => {
    const s = startFocus(initialFocusState(), T0);
    expect(s.endsAt).toBe(T0 + durationMs('focus'));
    expect(remainingAt(s, T0 + 60_000)).toBe(durationMs('focus') - 60_000);
    // 탭이 오래 멈춰 있어도 음수가 되지 않는다.
    expect(remainingAt(s, T0 + durationMs('focus') * 3)).toBe(0);
    expect(isFinished(s, T0 + durationMs('focus'))).toBe(true);
    expect(isFinished(s, T0 + durationMs('focus') - 1)).toBe(false);
  });

  it('일시정지하면 남은 시간이 고정되고 이어서 시작하면 그만큼 흐른다', () => {
    const running = startFocus(initialFocusState(), T0);
    const paused = pauseFocus(running, T0 + 60_000);
    expect(paused.status).toBe('paused');
    expect(remainingAt(paused, T0 + 999_999)).toBe(durationMs('focus') - 60_000);
    const resumed = startFocus(paused, T0 + 500_000);
    expect(resumed.endsAt).toBe(T0 + 500_000 + durationMs('focus') - 60_000);
  });

  it('시작을 두 번 눌러도 끝나는 시각이 밀리지 않는다', () => {
    const s = startFocus(initialFocusState(), T0);
    expect(startFocus(s, T0 + 5000).endsAt).toBe(s.endsAt);
  });

  it('초기화와 세션 전환', () => {
    const running = startFocus(initialFocusState(), T0);
    expect(resetFocus(running)).toMatchObject({ status: 'idle', endsAt: null, remainingMs: durationMs('focus') });
    expect(switchSession(running, 'short')).toMatchObject({ session: 'short', status: 'idle', remainingMs: durationMs('short') });
  });

  it('집중을 끝내면 완료 수가 오르고 네 번째마다 긴 휴식이다', () => {
    let state = initialFocusState();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const done = completeSession(state, TODAY);
      expect(done.finished).toBe('focus');
      seen.push(done.next);
      state = switchSession(done.state, 'focus');
    }
    expect(seen).toEqual(['short', 'short', 'short', 'long']);
    expect(state.rounds).toBe(4);
  });

  it('휴식을 끝내면 집중으로 돌아가고 완료 수는 그대로다', () => {
    const state = { ...switchSession(initialFocusState(), 'short'), rounds: 2, roundsDay: TODAY };
    const done = completeSession(state, TODAY);
    expect(done.next).toBe('focus');
    expect(done.state.rounds).toBe(2);
  });

  it('건너뛰기는 완료 수에 넣지 않는다', () => {
    const done = completeSession(initialFocusState(), TODAY, false);
    expect(done.state.rounds).toBe(0);
    expect(done.next).toBe('short');
  });

  it('날짜가 바뀌면 완료 수를 지운다', () => {
    const s = { ...initialFocusState(), rounds: 3, roundsDay: '2026-11-01' };
    expect(rollDay(s, TODAY)).toMatchObject({ rounds: 0, roundsDay: TODAY });
    expect(completeSession(s, TODAY).state.rounds).toBe(1);
    const same = { ...initialFocusState(), rounds: 3, roundsDay: TODAY };
    expect(rollDay(same, TODAY)).toBe(same);
  });

  it('화면의 오늘 횟수는 날짜가 바뀌면 바로 0이다', () => {
    const s = { ...initialFocusState(), rounds: 3, roundsDay: '2026-11-01' };
    expect(roundsOn(s, '2026-11-01')).toBe(3);
    expect(roundsOn(s, TODAY)).toBe(0);
    // 하이드레이션 전에도 어제 값을 보여주지 않는다.
    expect(roundsOn(s, '')).toBe(0);
  });

  it('저장된 값이 깨져 있어도 안전하게 복원한다', () => {
    expect(reviveFocusState(null)).toEqual(initialFocusState());
    expect(reviveFocusState('x')).toEqual(initialFocusState());
    const revived = reviveFocusState({ session: 'nope', status: 'running', endsAt: 'soon', remainingMs: 1e12, rounds: -2 });
    expect(revived.session).toBe('focus');
    expect(revived.status).toBe('idle');
    expect(revived.remainingMs).toBe(durationMs('focus'));
    expect(revived.rounds).toBe(0);
    const good = reviveFocusState({ session: 'short', status: 'running', endsAt: 123, remainingMs: 5, rounds: 2, roundsDay: TODAY, sound: true });
    expect(good).toMatchObject({ session: 'short', status: 'running', endsAt: 123, rounds: 2, sound: true });
  });

  it('시간 표시', () => {
    expect(formatTimer(25 * 60_000)).toBe('25:00');
    expect(formatTimer(24 * 60_000 + 59_001)).toBe('25:00');
    expect(formatTimer(61_000)).toBe('01:01');
    expect(formatTimer(0)).toBe('00:00');
  });
});
