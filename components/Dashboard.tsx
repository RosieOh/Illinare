'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare, Plus, Trash2, Check, Edit3,
  Clock, Cloud, Sun, CloudRain, CloudSnow, CloudLightning, Calendar,
  Briefcase, Users as UsersIcon,
  Play, Pause, RotateCcw,
} from 'lucide-react';

interface Weather {
  city: string;
  tempC: number;
  feelsC: number;
  desc: string;
  humidity: number;
  windKmh: number;
  icon: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';
}

function useWeather(city = 'Seoul') {
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) {
          setW(data);
          setErr(false);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [city]);
  return { weather: w, error: err };
}

const WEATHER_ICON = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
} as const;

// 우선순위 색은 semantic 토큰만 사용 (red/yellow는 직접 hex 대신 var)
const PRIORITY: Record<Todo['priority'], { dot: string; label: string }> = {
  high: { dot: 'var(--color-danger)', label: '높음' },
  normal: { dot: 'var(--color-info)', label: '보통' },
  low: { dot: 'var(--color-success)', label: '낮음' },
};

// ─── Widget shell — 헤더 일관성 위해 한 곳에서 관리 ─────────────────────
function WidgetShell({
  icon: Icon,
  title,
  trailing,
  children,
}: {
  icon: typeof CheckSquare;
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface rounded-xl p-4 h-full flex flex-col min-h-0">
      <header className="flex items-center gap-2 mb-3 flex-shrink-0">
        <Icon size={14} className="text-accent" aria-hidden="true" />
        <h2 className="text-xs text-secondary tracking-widest uppercase font-medium">
          {title}
        </h2>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </section>
  );
}

// ─── Todo Widget ────────────────────────────────────────────────────
interface Todo {
  id: number;
  text: string;
  done: boolean;
  priority: 'high' | 'normal' | 'low';
}

function TodoWidget() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<Todo['priority']>('normal');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('illionaire_todos');
      if (saved) setTodos(JSON.parse(saved));
    } catch {}
  }, []);

  const persist = (list: Todo[]) => {
    setTodos(list);
    localStorage.setItem('illionaire_todos', JSON.stringify(list));
  };

  const add = () => {
    if (!input.trim()) return;
    persist([...todos, { id: Date.now(), text: input.trim(), done: false, priority }]);
    setInput('');
  };

  const toggle = (id: number) =>
    persist(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: number) => persist(todos.filter((t) => t.id !== id));

  const remaining = todos.filter((t) => !t.done).length;

  return (
    <WidgetShell
      icon={CheckSquare}
      title="할 일 목록"
      trailing={
        <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--color-border)] text-muted">
          {remaining}개 남음
        </span>
      }
    >
      <div className="flex gap-2 mb-3 flex-shrink-0">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Todo['priority'])}
          aria-label="우선순위 선택"
          className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 text-xs text-primary"
        >
          <option value="high">높음</option>
          <option value="normal">보통</option>
          <option value="low">낮음</option>
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="새 항목 추가..."
          aria-label="할 일 입력"
          className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-primary placeholder-[var(--color-text-disabled)]"
        />
        <button
          onClick={add}
          aria-label="할 일 추가"
          className="p-2 rounded-md border border-[var(--color-border)] text-accent hover:bg-[var(--color-accent-soft)] transition-colors"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        <AnimatePresence initial={false}>
          {todos.map((todo) => (
            <motion.div
              key={todo.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                todo.done
                  ? 'border-[var(--color-border)] opacity-50'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: PRIORITY[todo.priority].dot }}
                aria-label={`우선순위 ${PRIORITY[todo.priority].label}`}
              />
              <button
                onClick={() => toggle(todo.id)}
                aria-pressed={todo.done}
                aria-label={`${todo.text} 완료 ${todo.done ? '취소' : '표시'}`}
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                  todo.done
                    ? 'bg-accent border-accent'
                    : 'border-[var(--color-border-strong)] hover:border-accent'
                }`}
                style={todo.done ? { backgroundColor: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : {}}
              >
                {todo.done && <Check size={10} className="text-[var(--color-surface-base)]" aria-hidden="true" />}
              </button>
              <span
                className={`flex-1 text-sm ${
                  todo.done ? 'line-through text-muted' : 'text-primary'
                }`}
              >
                {todo.text}
              </span>
              <button
                onClick={() => remove(todo.id)}
                aria-label={`${todo.text} 삭제`}
                className="text-muted hover:text-[var(--color-danger)] transition-colors"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {todos.length === 0 && (
          <div className="text-center text-muted text-xs py-6 border border-dashed border-[var(--color-border)] rounded-md">
            할 일을 추가해보세요
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

// ─── Memo Widget ────────────────────────────────────────────────────
function MemoWidget() {
  const [memo, setMemo] = useState('');
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    try {
      const s = localStorage.getItem('illionaire_memo');
      if (s) setMemo(s);
    } catch {}
  }, []);

  const handleChange = (v: string) => {
    setMemo(v);
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem('illionaire_memo', v);
      setSaved(true);
    }, 800);
  };

  return (
    <WidgetShell
      icon={Edit3}
      title="빠른 메모"
      trailing={
        <span
          className={`text-xs ${saved ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}
          role="status"
          aria-live="polite"
        >
          {saved ? '저장됨' : '저장 중...'}
        </span>
      }
    >
      <textarea
        value={memo}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="아이디어, 메모, 생각을 기록하세요..."
        aria-label="메모 입력"
        className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-3 text-sm text-primary placeholder-[var(--color-text-disabled)] resize-none font-mono leading-relaxed min-h-0"
      />
      <div className="flex justify-between mt-2 text-xs text-muted flex-shrink-0">
        <span>{memo.length}자</span>
        <button
          onClick={() => handleChange('')}
          className="hover:text-[var(--color-danger)] transition-colors"
        >
          초기화
        </button>
      </div>
    </WidgetShell>
  );
}

// ─── Pomodoro Timer ─────────────────────────────────────────────────
const SESSIONS = [
  { id: 'focus', label: '집중', minutes: 25 },
  { id: 'short', label: '짧은 휴식', minutes: 5 },
  { id: 'long', label: '긴 휴식', minutes: 15 },
] as const;

function TimerWidget() {
  const [sessionIdx, setSessionIdx] = useState(0);
  const [secs, setSecs] = useState(SESSIONS[0].minutes * 60);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const session = SESSIONS[sessionIdx];
  const total = session.minutes * 60;
  const progress = (total - secs) / total;
  const mins = Math.floor(secs / 60);
  const secStr = String(secs % 60).padStart(2, '0');

  const switchSession = useCallback((idx: number) => {
    clearInterval(intervalRef.current);
    setRunning(false);
    setSessionIdx(idx);
    setSecs(SESSIONS[idx].minutes * 60);
  }, []);

  useEffect(() => {
    if (!running) {
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          if (sessionIdx === 0) setRounds((r) => r + 1);
          const next = sessionIdx === 0 ? (rounds > 0 && (rounds + 1) % 4 === 0 ? 2 : 1) : 0;
          setTimeout(() => switchSession(next), 300);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, sessionIdx, rounds, switchSession]);

  const r = 54;
  const circumference = 2 * Math.PI * r;

  return (
    <WidgetShell
      icon={Clock}
      title="포모도로 타이머"
      trailing={<span className="text-xs text-muted">{rounds}회 완료</span>}
    >
      {/* Session tabs */}
      <div className="flex gap-1.5 mb-4 flex-shrink-0" role="tablist" aria-label="세션 선택">
        {SESSIONS.map((s, i) => {
          const isActive = sessionIdx === i;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => switchSession(i)}
              className={`flex-1 h-8 rounded-md text-xs border transition-colors ${
                isActive
                  ? 'bg-[var(--color-accent-soft)] text-primary border-[color:var(--color-accent-ring)]'
                  : 'border-[var(--color-border)] text-muted hover:text-primary'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className="relative w-36 h-36">
          <svg
            className="w-full h-full -rotate-90"
            viewBox="0 0 120 120"
            role="img"
            aria-label={`${session.label} 진행률 ${Math.round(progress * 100)}퍼센트`}
          >
            <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-mono font-medium text-primary tabular-nums">
              {mins}:{secStr}
            </div>
            <div className="text-xs mt-1 text-muted">{session.label}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-4 flex-shrink-0">
        <button
          onClick={() => setRunning((r) => !r)}
          aria-label={running ? '타이머 일시정지' : '타이머 시작'}
          className="flex-1 h-9 rounded-md text-sm font-medium transition-colors bg-[var(--color-accent-soft)] text-primary border border-[color:var(--color-accent-ring)] hover:bg-[var(--color-accent)] hover:text-[var(--color-surface-base)] flex items-center justify-center gap-2"
        >
          {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          {running ? '일시정지' : '시작'}
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setSecs(session.minutes * 60);
          }}
          aria-label="타이머 리셋"
          className="px-3 h-9 rounded-md border border-[var(--color-border)] text-secondary hover:text-primary transition-colors"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>
    </WidgetShell>
  );
}

// ─── Schedule Widget ────────────────────────────────────────────────
interface ScheduleItem {
  id: number;
  time: string;
  task: string;
  done: boolean;
  type: 'meeting' | 'work';
}

const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { id: 1, time: '09:00', task: '팀 스탠드업', done: false, type: 'meeting' },
  { id: 2, time: '11:00', task: 'AI 모델 검토', done: false, type: 'work' },
  { id: 3, time: '14:00', task: '클라이언트 미팅', done: false, type: 'meeting' },
  { id: 4, time: '16:00', task: '코드 리뷰', done: false, type: 'work' },
  { id: 5, time: '18:30', task: '주간 보고서', done: false, type: 'work' },
];

function ScheduleWidget() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [newTime, setNewTime] = useState('');
  const [newTask, setNewTask] = useState('');
  const [newType, setNewType] = useState<ScheduleItem['type']>('work');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('illionaire_schedule');
      setSchedule(saved ? JSON.parse(saved) : DEFAULT_SCHEDULE);
    } catch {
      setSchedule(DEFAULT_SCHEDULE);
    }
  }, []);

  const persist = (list: ScheduleItem[]) => {
    setSchedule(list);
    localStorage.setItem('illionaire_schedule', JSON.stringify(list));
  };

  const toggle = (id: number) =>
    persist(schedule.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  const remove = (id: number) => persist(schedule.filter((s) => s.id !== id));

  const addItem = () => {
    if (!newTime || !newTask.trim()) return;
    persist([
      ...schedule,
      { id: Date.now(), time: newTime, task: newTask.trim(), done: false, type: newType },
    ]);
    setNewTime('');
    setNewTask('');
    setAdding(false);
  };

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ko-KR', { hour12: false }));
      setDate(now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const sorted = [...schedule].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <section className="surface rounded-xl p-4 h-full flex flex-col min-h-0">
      {/* Clock */}
      <div className="text-center mb-3 pb-3 border-b border-[var(--color-border)] flex-shrink-0">
        <div
          className="text-[28px] font-mono font-medium text-primary tabular-nums tracking-wider"
          aria-label={`현재 시각 ${time}`}
        >
          {time || '00:00:00'}
        </div>
        <div className="text-xs text-muted mt-1">{date}</div>
      </div>

      <WeatherStrip />

      {/* Today's schedule */}
      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
        <Calendar size={12} className="text-accent" aria-hidden="true" />
        <span className="text-xs text-muted tracking-widest uppercase">오늘 일정</span>
        <button
          onClick={() => setAdding((v) => !v)}
          aria-label={adding ? '일정 추가 취소' : '일정 추가'}
          aria-expanded={adding}
          className="ml-auto p-1 rounded border border-[var(--color-border)] text-muted hover:text-accent hover:border-[color:var(--color-accent-ring)] transition-colors"
        >
          <Plus size={11} aria-hidden="true" />
        </button>
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex gap-1.5 overflow-hidden flex-shrink-0"
          >
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              aria-label="일정 시간"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-primary w-24"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ScheduleItem['type'])}
              aria-label="일정 유형"
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1 text-xs text-primary"
            >
              <option value="work">업무</option>
              <option value="meeting">미팅</option>
            </select>
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="일정 제목..."
              aria-label="일정 제목"
              className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-primary placeholder-[var(--color-text-disabled)]"
            />
            <button
              onClick={addItem}
              aria-label="일정 저장"
              className="p-1.5 rounded border border-[color:var(--color-accent-ring)] text-accent hover:bg-[var(--color-accent-soft)] transition-colors"
            >
              <Check size={11} aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        <AnimatePresence initial={false}>
          {sorted.map((item) => {
            const TypeIcon = item.type === 'meeting' ? UsersIcon : Briefcase;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border group transition-colors ${
                  item.done
                    ? 'border-[var(--color-border)] opacity-50'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
                }`}
              >
                <span className="text-xs font-mono text-muted w-10 flex-shrink-0 tabular-nums">
                  {item.time}
                </span>
                <button
                  onClick={() => toggle(item.id)}
                  aria-pressed={item.done}
                  aria-label={`${item.task} 완료 ${item.done ? '취소' : '표시'}`}
                  className="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center border-[var(--color-border-strong)] hover:border-accent transition-colors"
                >
                  {item.done && <Check size={9} className="text-[var(--color-success)]" aria-hidden="true" />}
                </button>
                <TypeIcon
                  size={11}
                  className={item.type === 'meeting' ? 'text-[var(--color-warning)]' : 'text-accent'}
                  aria-label={item.type === 'meeting' ? '미팅' : '업무'}
                />
                <span
                  className={`flex-1 text-sm ${
                    item.done ? 'line-through text-muted' : 'text-primary'
                  }`}
                >
                  {item.task}
                </span>
                <button
                  onClick={() => remove(item.id)}
                  aria-label={`${item.task} 삭제`}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted hover:text-[var(--color-danger)] transition-all"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {schedule.length === 0 && (
          <div className="text-center text-muted text-xs py-4 border border-dashed border-[var(--color-border)] rounded-md">
            일정을 추가해보세요
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Weather Strip ──────────────────────────────────────────────────
function WeatherStrip() {
  const { weather, error } = useWeather('Seoul');
  if (error) {
    return (
      <div className="flex items-center gap-3 mb-3 p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] flex-shrink-0">
        <Cloud size={20} className="text-muted" aria-hidden="true" />
        <span className="text-xs text-muted">날씨 데이터를 불러올 수 없습니다</span>
      </div>
    );
  }
  if (!weather) {
    return (
      <div className="flex items-center gap-3 mb-3 p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] flex-shrink-0">
        <Cloud size={20} className="text-muted animate-pulse" aria-hidden="true" />
        <span className="text-xs text-muted">날씨 로딩 중...</span>
      </div>
    );
  }
  const Icon = WEATHER_ICON[weather.icon];
  return (
    <div className="flex items-center gap-3 mb-3 p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] flex-shrink-0">
      <Icon size={20} className="text-secondary" aria-hidden="true" />
      <div>
        <div className="text-base font-medium text-primary tabular-nums">{weather.tempC}°C</div>
        <div className="text-xs text-muted">
          {weather.city} · {weather.desc}
        </div>
      </div>
      <div className="ml-auto grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span className="text-muted">체감</span>
        <span className="text-secondary font-mono tabular-nums">{weather.feelsC}°C</span>
        <span className="text-muted">습도</span>
        <span className="text-secondary font-mono tabular-nums">{weather.humidity}%</span>
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────
export default function Dashboard() {
  return (
    <div className="h-full p-4">
      {/* lg 이상에서만 2x2, 그 미만에서는 single column으로 fallback */}
      <div className="h-full grid gap-4 grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 overflow-y-auto lg:overflow-hidden">
        <TodoWidget />
        <MemoWidget />
        <TimerWidget />
        <ScheduleWidget />
      </div>
    </div>
  );
}

