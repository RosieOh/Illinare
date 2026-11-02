import type {
  MissionEvent,
  MissionStatus,
  MissionView,
  StepView,
  ToolCallView,
  UsageTotals,
} from '@/lib/contracts';

/**
 * 미션 상태의 단일 진실 공급원. 서버는 이벤트를 적용해 저장하고,
 * 클라이언트는 같은 이벤트를 적용해 화면을 그린다. 순수 함수.
 */
export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function patchStep(view: MissionView, stepId: string, patch: (s: StepView) => StepView): MissionView {
  const step = view.steps[stepId];
  if (!step) return view;
  return { ...view, steps: { ...view.steps, [stepId]: patch(step) } };
}

function dropTail(text: string, chars: number): string {
  return chars > 0 ? text.slice(0, Math.max(0, text.length - chars)) : text;
}

function patchCall(step: StepView, callId: string, patch: (c: ToolCallView) => ToolCallView): StepView {
  return { ...step, toolCalls: step.toolCalls.map((c) => (c.callId === callId ? patch(c) : c)) };
}

/** 대기 중인 승인이 남아 있지 않으면 단계 상태를 running으로 되돌린다. */
function settleAfterApproval(view: MissionView, stepId: string | undefined): MissionView {
  if (!stepId) return view;
  const stillWaiting = view.approvals.some((a) => a.stepId === stepId);
  if (stillWaiting) return view;
  return patchStep(view, stepId, (s) =>
    s.status === 'awaiting_approval' ? { ...s, status: 'running' } : s
  );
}

export function applyMissionEvent(prev: MissionView | null, event: MissionEvent): MissionView {
  if (event.type === 'mission.created') {
    return {
      id: event.id,
      goal: event.goal,
      title: event.goal.slice(0, 40),
      status: 'planning',
      mode: event.mode,
      plan: null,
      steps: {},
      stepOrder: [],
      conductorThinking: '',
      answer: '',
      turns: [],
      approvals: [],
      artifacts: [],
      usage: emptyUsage(),
      budgetUsd: event.budgetUsd,
      turnStartCostUsd: 0,
      createdAt: event.at,
      turnStartedAt: event.at,
      updatedAt: event.at,
      seq: event.seq,
    };
  }
  if (!prev) throw new Error(`mission.created 이전에 ${event.type} 이벤트를 받았습니다`);

  // 재연결 시 이미 적용한 이벤트는 무시한다.
  if (event.seq <= prev.seq) return prev;

  const view = reduce(prev, event);
  return { ...view, seq: event.seq, updatedAt: event.at };
}

function reduce(view: MissionView, event: MissionEvent): MissionView {
  switch (event.type) {
    case 'mission.status':
      return { ...view, status: event.status };

    case 'mission.followup':
      return {
        ...view,
        goal: event.goal,
        status: 'planning',
        turns: [...view.turns, { goal: view.goal, at: view.updatedAt, answer: view.answer }],
        plan: null,
        steps: {},
        stepOrder: [],
        conductorThinking: '',
        answer: '',
        error: undefined,
        finishedAt: undefined,
        // 이전 버전이 저장한 이벤트에는 budgetUsd와 mode가 없을 수 있다.
        budgetUsd: event.budgetUsd ?? view.budgetUsd,
        mode: event.mode ?? view.mode,
        turnStartCostUsd: view.usage.costUsd,
        turnStartedAt: event.at,
      };

    case 'conductor.thinking':
      return { ...view, conductorThinking: view.conductorThinking + event.delta };

    case 'plan.ready': {
      const steps: Record<string, StepView> = {};
      for (const step of event.plan.steps) {
        steps[step.id] = {
          step,
          status: 'pending',
          thinking: '',
          text: '',
          activity: '',
          toolCalls: [],
          usage: emptyUsage(),
          tainted: false,
        };
      }
      return {
        ...view,
        plan: event.plan,
        // 후속 지시로 목록의 미션 이름이 바뀌면 찾기 어려워지므로 첫 계획의 제목을 유지한다.
        title: view.turns.length > 0 ? view.title : event.plan.title || view.title,
        steps,
        stepOrder: event.plan.steps.map((s) => s.id),
      };
    }

    case 'step.started':
      return patchStep(view, event.stepId, (s) => ({ ...s, status: 'running', startedAt: event.at }));

    case 'step.thinking':
      return patchStep(view, event.stepId, (s) => ({ ...s, thinking: s.thinking + event.delta }));

    case 'step.text':
      return patchStep(view, event.stepId, (s) => ({ ...s, text: s.text + event.delta }));

    case 'step.rollback':
      return patchStep(view, event.stepId, (s) => ({
        ...s,
        text: dropTail(s.text, event.textChars),
        thinking: dropTail(s.thinking, event.thinkingChars),
      }));

    case 'step.activity':
      return patchStep(view, event.stepId, (s) => ({ ...s, activity: event.activity }));

    case 'step.tainted':
      return patchStep(view, event.stepId, (s) => ({ ...s, tainted: true }));

    case 'step.finished':
      return patchStep(view, event.stepId, (s) => ({
        ...s,
        status: event.status,
        output: event.output ?? s.output,
        error: event.error,
        activity: '',
        finishedAt: event.at,
      }));

    case 'tool.started':
      return patchStep(view, event.call.stepId, (s) => ({
        ...s,
        toolCalls: [...s.toolCalls, event.call],
        activity: event.call.summary,
      }));

    case 'tool.finished':
      return patchStep(view, event.stepId, (s) =>
        patchCall(s, event.callId, (c) => ({
          ...c,
          status: event.status,
          result: event.result,
          undoId: event.undoId,
          finishedAt: event.at,
        }))
      );

    case 'approval.requested': {
      const next = { ...view, approvals: [...view.approvals, event.approval] };
      const { stepId } = event.approval;
      return stepId
        ? patchStep(next, stepId, (s) => ({ ...s, status: 'awaiting_approval' }))
        : next;
    }

    case 'approval.resolved': {
      const target = view.approvals.find((a) => a.id === event.id);
      const next = { ...view, approvals: view.approvals.filter((a) => a.id !== event.id) };
      return settleAfterApproval(next, target?.stepId);
    }

    case 'usage': {
      const next = { ...view, usage: addUsage(view.usage, event.delta) };
      return event.stepId
        ? patchStep(next, event.stepId, (s) => ({ ...s, usage: addUsage(s.usage, event.delta) }))
        : next;
    }

    case 'answer.delta':
      return { ...view, answer: view.answer + event.delta };

    case 'answer.rollback':
      return {
        ...view,
        answer: dropTail(view.answer, event.textChars),
        conductorThinking: dropTail(view.conductorThinking, event.thinkingChars),
      };

    case 'answer.done':
      // 빈 응답으로 끝나도 이미 받은 답변을 지우지 않는다. 거절만 clear로 지운다.
      return { ...view, answer: event.clear ? '' : event.text || view.answer };

    case 'artifact':
      return { ...view, artifacts: [...view.artifacts, event.artifact] };

    case 'mission.error':
      return { ...view, error: { code: event.code, message: event.message } };

    case 'mission.finished':
      return { ...view, status: event.status, approvals: [], finishedAt: event.at };

    case 'mission.created':
      return view;
  }
}

/** 활성 상태인가 (실행 중이거나 입력을 기다리는 중) */
export function isActive(status: MissionStatus): boolean {
  return status !== 'done' && status !== 'failed' && status !== 'cancelled';
}
