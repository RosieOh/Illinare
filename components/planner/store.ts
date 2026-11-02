'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CalendarEvent, MissionView, Task, TaskPriority } from '@/lib/contracts';
import { useToast } from '@/components/glass';
import { useMissions } from '@/context/MissionsContext';
import {
  addEvent,
  addTask,
  getPlannerState,
  INITIAL_PLANNER_STATE,
  patchEvent,
  patchTask,
  plannerErrorMessage,
  refreshPlanner,
  removeEventLater,
  removeTaskLater,
  subscribePlanner,
  UNDO_WINDOW_MS,
  type EventInput,
  type PlannerState,
} from './core';

export { isTemp, refreshPlanner, rowKey, type EventInput, type PlannerState } from './core';

export function usePlannerState(): PlannerState {
  return useSyncExternalStore(subscribePlanner, getPlannerState, () => INITIAL_PLANNER_STATE);
}

const PLANNER_TOOLS = new Set(['add_task', 'complete_task', 'remove_task', 'add_event', 'remove_event']);

/** 에이전트가 할 일이나 일정을 바꾸면 이 값이 달라진다. */
function missionChangeSignature(missions: Record<string, MissionView>): string {
  let artifacts = 0;
  let calls = 0;
  for (const mission of Object.values(missions)) {
    artifacts += mission.artifacts.filter((a) => a.kind === 'task' || a.kind === 'event').length;
    for (const step of Object.values(mission.steps)) {
      calls += step.toolCalls.filter((c) => c.status === 'ok' && PLANNER_TOOLS.has(c.name)).length;
    }
  }
  return `${artifacts}:${calls}`;
}

/** 뷰가 보일 때, 창에 돌아왔을 때, 에이전트가 항목을 바꿨을 때 다시 읽는다. */
export function usePlannerSync(active: boolean) {
  useEffect(() => {
    if (active) void refreshPlanner();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => void refreshPlanner();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshPlanner();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  const { missions } = useMissions();
  const signature = useMemo(() => missionChangeSignature(missions), [missions]);
  useEffect(() => {
    if (signature !== '0:0') void refreshPlanner();
  }, [signature]);
}

/** 저장소 변경에 실패 알림과 되돌리기 알림을 붙인 묶음 */
export function usePlannerActions() {
  const toast = useToast();
  return useMemo(() => {
    const fail = (title: string) => (err: unknown) => {
      toast({ tone: 'danger', title, description: plannerErrorMessage(err, '앱 서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요.') });
    };
    return {
      addTask: (input: { text: string; priority: TaskPriority; due?: string }) =>
        addTask(input).catch(fail('할 일을 추가하지 못했어요')),
      patchTask: (id: string, patch: Partial<Task>) => patchTask(id, patch).catch(fail('할 일을 바꾸지 못했어요')),
      removeTask: (task: Task) => {
        const undo = removeTaskLater(task, fail('할 일을 삭제하지 못했어요'));
        toast({
          title: '할 일을 삭제했어요',
          description: task.text,
          action: { label: '되돌리기', onClick: undo },
          duration: UNDO_WINDOW_MS,
        });
      },
      addEvent: (input: EventInput) => addEvent(input).catch(fail('일정을 추가하지 못했어요')),
      patchEvent: (id: string, patch: Partial<CalendarEvent>) => patchEvent(id, patch).catch(fail('일정을 바꾸지 못했어요')),
      removeEvent: (event: CalendarEvent) => {
        const undo = removeEventLater(event, fail('일정을 삭제하지 못했어요'));
        toast({
          title: '일정을 삭제했어요',
          description: event.title,
          action: { label: '되돌리기', onClick: undo },
          duration: UNDO_WINDOW_MS,
        });
      },
    };
  }, [toast]);
}
