'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { Button, EmptyState, Material, spring } from '@/components/glass';
import { useLingering } from '@/components/planner/hooks';
import { sortTasks } from '@/components/planner/logic';
import { refreshPlanner, rowKey, usePlannerActions, type PlannerState } from '@/components/planner/store';
import { TaskQuickAdd } from '@/components/planner/TaskQuickAdd';
import { TaskRow, TaskRowSkeletons } from '@/components/planner/TaskRow';

const TOP_ITEMS = 5;

export function TodayTasksCard({ planner, today, onOpenPlanner }: {
  planner: PlannerState;
  today: string;
  onOpenPlanner: () => void;
}) {
  const actions = usePlannerActions();
  const { lingering, linger } = useLingering();
  const { tasks, status } = planner;

  const open = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const top = useMemo(() => {
    const shown = tasks.filter((t) => !t.done || lingering.has(t.id));
    const asOpen = shown.map((t) => (lingering.has(t.id) ? { ...t, done: false } : t));
    const byId = new Map(shown.map((t) => [t.id, t]));
    return sortTasks(asOpen, 'smart', today)
      .slice(0, TOP_ITEMS)
      .map((t) => byId.get(t.id)!);
  }, [tasks, lingering, today]);
  const more = Math.max(0, open.length - TOP_ITEMS);

  return (
    <Material as="section" aria-labelledby="today-tasks" className="flex flex-1 flex-col p-4">
      <header className="mb-2.5 flex items-baseline justify-between gap-2 px-1">
        <h2 id="today-tasks" className="text-headline text-label">
          할 일
        </h2>
        {status === 'ready' && open.length > 0 && <span className="text-footnote text-label-2 tabular-nums">{open.length}개 남음</span>}
      </header>

      <TaskQuickAdd today={today} onAdd={(input) => void actions.addTask(input)} showOptions={false} placeholder="할 일 추가 (예: 금요일 세금 계산서)" />

      <div className="mt-1.5 flex-1">
        {status === 'loading' && tasks.length === 0 ? (
          <TaskRowSkeletons count={3} />
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
        ) : top.length === 0 ? (
          <p className="px-2.5 py-5 text-center text-subhead text-label-2">
            {tasks.length > 0 ? '남은 일을 모두 끝냈어요.' : '오늘 할 일을 적어 두면 여기에 모여요.'}
          </p>
        ) : (
          <ul aria-label="먼저 볼 할 일">
            <AnimatePresence initial={false}>
              {top.map((task) => (
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
                    compact
                    task={task}
                    today={today}
                    onToggle={() => {
                      linger(task.id);
                      void actions.patchTask(task.id, { done: !task.done });
                    }}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {status === 'ready' && tasks.length > 0 && (
        <div className="mt-1 flex justify-end">
          <Button size="sm" variant="plain" onClick={onOpenPlanner}>
            {more > 0 ? `${more}개 더 보기` : '플래너에서 보기'}
          </Button>
        </div>
      )}
    </Material>
  );
}
