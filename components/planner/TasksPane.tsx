'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, CheckCircle2, ChevronDown, CircleAlert, ListChecks, PartyPopper, RotateCcw } from 'lucide-react';
import type { Task } from '@/lib/contracts';
import { Button, EmptyState, Material, Segmented, spring, type SegmentedOption } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { useLingering } from './hooks';
import { filterTasks, sortTasks, taskCounts, type TaskFilter, type TaskSort } from './logic';
import { refreshPlanner, rowKey, usePlannerActions, type PlannerState } from './store';
import { TaskQuickAdd } from './TaskQuickAdd';
import { TaskRow, TaskRowSkeletons } from './TaskRow';

const SORT_OPTIONS: Array<{ value: TaskSort; label: string }> = [
  { value: 'smart', label: '중요한 순' },
  { value: 'due', label: '기한순' },
  { value: 'priority', label: '우선순위순' },
  { value: 'recent', label: '최근 추가순' },
];

const EMPTY: Record<TaskFilter, { icon: typeof ListChecks; title: string; description: string }> = {
  today: { icon: PartyPopper, title: '오늘까지 할 일이 없어요', description: '기한이 오늘이거나 지난 일이 여기에 모여요.' },
  upcoming: { icon: CalendarClock, title: '앞으로 예정된 일이 없어요', description: '"금요일 발표 준비"처럼 쓰면 기한이 저절로 들어가요.' },
  all: { icon: ListChecks, title: '아직 할 일이 없어요', description: '위에 적거나, 미션에 "이번 주 할 일을 정리해 줘"라고 맡겨 보세요.' },
  done: { icon: CheckCircle2, title: '아직 끝낸 일이 없어요', description: '체크한 일이 여기에 남아요.' },
};

/** 체크 애니메이션이 끝날 때까지 끝내지 않은 것처럼 순서를 유지한다. */
function withLingering(tasks: Task[], lingering: ReadonlySet<string>): Task[] {
  if (lingering.size === 0) return tasks;
  return tasks.map((t) => (lingering.has(t.id) ? { ...t, done: !t.done } : t));
}

export function TasksPane({ planner, today }: { planner: PlannerState; today: string }) {
  const { navigate } = useApp();
  const { focus } = useMissions();
  const actions = usePlannerActions();
  const [chosenFilter, setChosenFilter] = useState<TaskFilter | null>(null);
  const [sort, setSort] = useState<TaskSort>('smart');
  const { lingering, linger } = useLingering();

  const { tasks, status } = planner;
  const counts = useMemo(() => taskCounts(tasks, today), [tasks, today]);
  // 고르기 전에는 오늘 할 일이 있으면 오늘을, 없으면 전체를 보여준다.
  const filter: TaskFilter = chosenFilter ?? (counts.today > 0 ? 'today' : 'all');

  const visible = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const asShown = withLingering(tasks, lingering);
    const filtered = filterTasks(asShown, filter, today);
    return sortTasks(filtered, sort, today).map((t) => byId.get(t.id) as Task);
  }, [tasks, lingering, filter, sort, today]);

  const options: SegmentedOption<TaskFilter>[] = [
    { value: 'today', label: `오늘 ${counts.today}` },
    { value: 'upcoming', label: `예정 ${counts.upcoming}` },
    { value: 'all', label: `전체 ${counts.all}` },
    { value: 'done', label: `완료 ${counts.done}` },
  ];

  const openMission = (id: string) => {
    focus(id);
    navigate('missions');
  };

  const empty = EMPTY[filter];

  return (
    <Material as="section" aria-label="할 일" className="flex h-full min-h-0 flex-col p-3.5">
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-title3 text-label">할 일</h2>
        <label className="relative inline-flex h-8 items-center rounded-[10px] text-footnote font-medium text-label-2 hover:bg-fill-3 hover:text-label">
          <span className="sr-only">정렬</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as TaskSort)}
            className="h-full appearance-none rounded-[10px] bg-transparent pr-7 pl-2.5 outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2" aria-hidden="true" />
        </label>
      </header>

      <Segmented options={options} value={filter} onChange={setChosenFilter} label="할 일 필터" size="sm" fullWidth className="shrink-0" />

      <div className="mt-3 shrink-0">
        <TaskQuickAdd today={today} onAdd={(input) => void actions.addTask(input)} />
      </div>

      <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-3 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_16px),transparent)]">
        {status === 'loading' && tasks.length === 0 ? (
          <TaskRowSkeletons count={5} />
        ) : status === 'error' ? (
          <EmptyState
            compact
            icon={CircleAlert}
            title="할 일을 불러오지 못했어요"
            description={planner.error}
            action={
              <Button size="sm" icon={RotateCcw} onClick={() => void refreshPlanner()}>
                다시 시도
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={empty.icon} title={empty.title} description={empty.description} />
        ) : (
          <ul aria-label={`${options.find((o) => o.value === filter)?.label} 목록`}>
            <AnimatePresence initial={false}>
              {visible.map((task) => (
                <motion.li
                  key={rowKey(task.id)}
                  layout="position"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring.gentle}
                  className="overflow-hidden"
                >
                  <TaskRow
                    task={task}
                    today={today}
                    onToggle={() => {
                      linger(task.id);
                      void actions.patchTask(task.id, { done: !task.done });
                    }}
                    onPatch={(patch) => void actions.patchTask(task.id, patch)}
                    onRemove={() => actions.removeTask(task)}
                    onOpenMission={openMission}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Material>
  );
}
