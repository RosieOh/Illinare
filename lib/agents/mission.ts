import type {
  ApprovalDecision,
  ApprovalRequest,
  MissionEvent,
  MissionEventBody,
  MissionPlan,
  MissionStatus,
  MissionSummary,
  MissionView,
  PlanStep,
  Settings,
} from '@/lib/contracts';
import { TERMINAL_STATUSES } from '@/lib/contracts';
import { applyMissionEvent } from '@/lib/missions/reducer';
import { newId } from '@/lib/store/json';
import { listMemory } from '@/lib/store/memory';
import { apiKeyInfo, getApiKey } from '@/lib/store/secrets';
import { getSettings } from '@/lib/store/settings';
import { ApiError } from '@/lib/server/http';
import { DeltaCoalescer, runAgentLoop, type AgentHooks } from './agent-loop';
import { cancelApprovals, hasApproval, requestApproval, resolveApproval } from './approvals';
import { BudgetGuard } from './budget';
import { buildPreamble, formatEarlierTurns, neutralizeTags, wrapUpstream } from './context';
import { runDemo } from './demo';
import { BudgetExceededError, CancelledError, describeError, EmptyResponseError, IncompleteRunError, isCancellation, RefusedError } from './errors';
import { createClient, type Effort, type LlmClient } from './llm';
import {
  deleteStoredMission,
  isMissionId,
  listStoredMissionIds,
  loadEvents,
  loadPendingInputs,
  loadSnapshot,
  MissionWriter,
  persistableEvent,
  removeInterruptedInputs,
  repairEventLogTail,
  replayEvents,
  settlePendingInputs,
  summaryOf,
  withInterruptedInputs,
} from './persistence';
import { makePlan, PLAN_FALLBACK_NOTE } from './planner';
import {
  ANSWER_EFFORT,
  CONDUCTOR_ANSWER_SYSTEM,
  CONDUCTOR_SYNTH_SYSTEM,
  modelFor,
  SYNTH_EFFORT,
} from './roster';
import { runStep } from './step-runner';

const MAX_CONCURRENT_STEPS = 3;
const MAX_ACTIVE_MISSIONS = 5;
const MAX_FINISHED_IN_MEMORY = 30;
const MAX_LISTED = 200;
const ANSWER_MAX_TOKENS = 64_000;
/** 재시작 뒤 복구 이벤트의 seq를 이만큼 건너뛴다. 클라이언트가 이미 더 큰 seq를 봤을 수 있다 (디스크에 못 쓴 이벤트). */
const RECOVERY_SEQ_JUMP = 1000;
/** 지우기 전에 돌던 도구를 기다리는 시간. 멈추지 않는 도구 때문에 삭제가 끝없이 밀리면 안 된다. */
const QUIESCE_MS = 5000;
const TRUNCATED_NOTE = '\n\n(응답이 길이 제한에 걸려 여기서 끊겼어요.)';
const INTERRUPTED_NOTE = '승인을 기다리던 중 앱이 다시 시작되어 실행하지 않았어요. 입력 내용은 후속 지시를 보내거나 미션을 지우면 함께 지워져요.';
export const MAX_GOAL_CHARS = 8000;

type Emit = (body: MissionEventBody) => void;

function isTerminal(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new CancelledError());
    else signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
  });
}

interface StepOutcome {
  status: 'done' | 'failed' | 'skipped' | 'cancelled';
  output?: string;
  tainted: boolean;
  error?: ReturnType<typeof describeError>;
}

/**
 * 미션 한 건. 상태는 서버가 소유한다. 클라이언트는 목표 문장과 승인 결정만 보낼 수 있으므로
 * 위조된 assistant 턴이나 tool_use가 들어올 경로가 없다.
 */
class Mission {
  view!: MissionView;
  readonly events: MissionEvent[] = [];
  private readonly subscribers = new Set<(event: MissionEvent) => void>();
  private readonly writer: MissionWriter;
  private seq = 0;
  private controller = new AbortController();
  private runId = 0;
  settled: Promise<void> = Promise.resolve();
  /** 이번 실행의 모델 호출과 도구가 실제로 끝났을 때 풀린다. settled는 취소되면 바로 풀린다. */
  private flowDone: Promise<unknown> = Promise.resolve();

  constructor(readonly id: string) {
    this.writer = new MissionWriter(id);
  }

  /** 디스크에서 되살릴 때 쓴다. */
  restore(events: MissionEvent[], view: MissionView) {
    this.events.push(...events);
    this.view = view;
    this.seq = view.seq;
  }

  /**
   * 재시작으로 끊긴 미션을 닫는다. 클라이언트가 무시하지 않도록 seq를 건너뛴다.
   * 에이전트의 대화 상태는 메모리에만 있어 대기 중이던 승인은 이어갈 수 없다. 실행하지 않고 입력만 볼 수 있게 남긴다.
   */
  closeAfterRestart(interruptedCalls: string[] = []) {
    this.seq += RECOVERY_SEQ_JUMP;
    this.emit({
      type: 'mission.error',
      code: 'internal',
      message: '앱이 다시 시작되어 이 미션을 이어갈 수 없어요. 후속 지시로 다시 요청해 주세요.',
    });
    const emit: Emit = (body) => this.emit(body);
    for (const stepId of this.view.stepOrder) {
      for (const call of this.view.steps[stepId].toolCalls) {
        if (call.status === 'running' && interruptedCalls.includes(call.callId)) {
          emit({ type: 'tool.finished', stepId, callId: call.callId, status: 'denied', result: INTERRUPTED_NOTE });
        }
      }
    }
    this.closeOpenWork('failed', emit);
    this.emit({ type: 'mission.finished', status: 'failed' });
  }

  emit(body: MissionEventBody) {
    const event = { ...body, seq: ++this.seq, at: Date.now() } as MissionEvent;
    this.view = applyMissionEvent(this.view ?? null, event);
    this.events.push(event);
    this.writer.record(event, this.view);
    this.forgetDecided(event);
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (err) {
        console.error('[mission] 구독자 오류', err);
      }
    }
  }

  /**
   * 결정이 나면 내용을 더 들고 있지 않는다. 재연결 때 이벤트를 다시 보내므로 메모리의 이벤트에서도 뺀다.
   * 대기 중인 동안에는 그대로 둔다. 끊겼다 다시 붙은 화면도 승인 카드의 비교를 볼 수 있어야 한다.
   */
  private forgetDecided(event: MissionEvent) {
    if (event.type !== 'approval.resolved' && event.type !== 'mission.finished') return;
    this.events.forEach((earlier, index) => {
      if (earlier.type !== 'approval.requested') return;
      if (event.type === 'mission.finished' || earlier.approval.id === event.id) {
        this.events[index] = persistableEvent(earlier);
      }
    });
    if (event.type === 'approval.resolved') this.writer.dropPending(event.id);
    else this.writer.dropUndecidedPending();
  }

  subscribe(fn: (event: MissionEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  flush(): Promise<void> {
    return this.writer.flush();
  }

  get terminal(): boolean {
    return isTerminal(this.view.status);
  }

  /**
   * 취소되었거나 끝난 실행에서 늦게 도착한 이벤트는 버린다.
   * 사용량만은 예외다. 취소된 호출의 비용도 실제로 나간 돈이라 기록에서 빠지면 안 된다.
   */
  private scopedEmit(runId: number): Emit {
    return (body) => {
      if (runId === this.runId && (!this.terminal || body.type === 'usage')) this.emit(body);
    };
  }

  /**
   * 파일을 지우기 직전에 부른다. 취소는 미션을 바로 닫지만 돌던 도구는 바로 멈추지 않으므로 잠깐 기다리고,
   * 그 뒤에 도착하는 이벤트가 지운 파일을 되살리지 못하게 막는다.
   */
  async quiesce(): Promise<void> {
    await this.settled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.flowDone, new Promise((resolve) => (timer = setTimeout(resolve, QUIESCE_MS)))]);
    clearTimeout(timer);
    if (this.terminal) this.runId++;
    await this.flush();
  }

  start(goal: string) {
    this.settled = this.runToEnd(goal).catch((err) => console.error('[mission] 실행 오류', err));
  }

  followup(goal: string, turn: { budgetUsd: number; mode: 'live' | 'demo' }) {
    // 앞선 실행이 남아 있으면 끊는다. 버려진 실행이 상한과 화면 밖에서 계속 돌면 안 된다.
    this.controller.abort();
    this.controller = new AbortController();
    this.emit({ type: 'mission.followup', goal, budgetUsd: turn.budgetUsd, mode: turn.mode });
    this.settled = this.runToEnd(goal).catch((err) => console.error('[mission] 실행 오류', err));
  }

  cancel() {
    if (this.terminal) return;
    const pending = cancelApprovals(this.id);
    for (const a of pending) this.emit({ type: 'approval.resolved', id: a.id, decision: 'deny' });
    this.controller.abort();
  }

  async decide(approvalId: string, decision: ApprovalDecision, remember: boolean): Promise<boolean> {
    if (!hasApproval(this.id, approvalId)) return false;
    this.emit({ type: 'approval.resolved', id: approvalId, decision });
    this.syncApprovalStatus();
    return resolveApproval(this.id, approvalId, decision, remember);
  }

  private syncApprovalStatus() {
    if (this.terminal) return;
    const pending = this.view.approvals.length;
    const { status } = this.view;
    if (pending > 0 && (status === 'running' || status === 'synthesizing')) {
      this.emit({ type: 'mission.status', status: 'awaiting_approval' });
    } else if (pending === 0 && status === 'awaiting_approval') {
      this.emit({ type: 'mission.status', status: 'running' });
    }
  }

  private askApproval(approval: ApprovalRequest, emit: Emit, signal: AbortSignal, input?: unknown): Promise<ApprovalDecision> {
    // 취소 뒤에 등록하면 아무도 풀어주지 않는 대기자가 남는다.
    if (signal.aborted || this.terminal) return Promise.reject(new CancelledError());
    const wait = requestApproval(this.id, approval);
    if (input !== undefined) this.writer.savePending(approval, input);
    emit({ type: 'approval.requested', approval });
    this.syncApprovalStatus();
    return wait;
  }

  private async runToEnd(goal: string): Promise<void> {
    const runId = ++this.runId;
    const emit = this.scopedEmit(runId);
    const { signal } = this.controller;
    const flow = this.flow(goal, emit, signal);
    this.flowDone = flow.catch(() => undefined);

    let status: MissionStatus;
    try {
      status = await Promise.race([flow, rejectOnAbort(signal)]);
    } catch (err) {
      if (isCancellation(err) || signal.aborted) {
        status = 'cancelled';
      } else {
        // 거절된 부분 답변은 불완전하므로 화면과 다음 턴의 문맥에 남기지 않는다.
        if (err instanceof RefusedError) emit({ type: 'answer.done', text: '', clear: true });
        const { code, message } = describeError(err);
        emit({ type: 'mission.error', code, message });
        status = 'failed';
      }
    }
    // 새 턴이 이 실행을 이어받았다. 미션을 닫는 것은 그 턴의 몫이다.
    if (runId !== this.runId) return;
    this.closeOpenWork(status, emit);
    this.emit({ type: 'mission.finished', status });
    cancelApprovals(this.id);
    await this.flush();
    onMissionSettled(this);
  }

  /** 끝났는데 열려 있는 단계와 도구 호출을 닫는다. 화면에 도는 표시가 남지 않게 한다. */
  private closeOpenWork(status: MissionStatus, emit: Emit) {
    for (const stepId of this.view.stepOrder) {
      const step = this.view.steps[stepId];
      for (const call of step.toolCalls) {
        if (call.status === 'running') {
          emit({ type: 'tool.finished', stepId, callId: call.callId, status: 'denied', result: '미션이 끝나 결과를 기다리지 않았어요. 실제로 실행됐는지는 활동 기록에서 볼 수 있어요.' });
        }
      }
      if (step.status === 'pending' || step.status === 'running' || step.status === 'awaiting_approval') {
        emit({
          type: 'step.finished',
          stepId,
          status: status === 'cancelled' ? 'cancelled' : 'skipped',
        });
      }
    }
  }

  private async flow(goal: string, emit: Emit, signal: AbortSignal): Promise<MissionStatus> {
    if (this.view.mode === 'demo') {
      await runDemo(goal, {
        emit,
        signal,
        askApproval: (approval) => this.askApproval(approval, emit, signal),
      });
      return signal.aborted ? 'cancelled' : 'done';
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      emit({ type: 'mission.error', code: 'no_api_key', message: 'Anthropic API 키가 없어요. 설정에서 키를 등록해 주세요.' });
      return 'failed';
    }
    const [settings, memory] = await Promise.all([getSettings(), listMemory()]);
    const client = createClient(apiKey);
    const preamble = buildPreamble(settings, memory);
    const earlier = formatEarlierTurns(this.view.turns);
    const safeGoal = neutralizeTags(goal);
    const budget = new BudgetGuard(this.view.budgetUsd, () => this.view.usage.costUsd - (this.view.turnStartCostUsd ?? 0));
    const beforeModelCall: AgentHooks['beforeModelCall'] = (estimate) => budget.acquire(signal, { estimate });
    const conductorModel = modelFor('conductor', settings.modelPreset);
    // 이전 턴의 답변에 외부 내용이 섞였을 수 있고, 에이전트가 저장한 기억은 외부 내용에서 왔을 수 있다.
    // 지휘자가 이 문맥을 읽고 작업 지시를 쓰므로 단계들도 오염 상태로 시작한다.
    const carriedTaint =
      (this.view.turns.length > 0 && this.events.some((e) => e.type === 'step.tainted')) ||
      memory.some((m) => m.source === 'agent');

    const plan = await makePlanWithEvents(client, conductorModel, {
      userMessage: [preamble, earlier, `<mission_goal>\n${safeGoal}\n</mission_goal>`].filter(Boolean).join('\n\n'),
      fallbackTitle: goal.slice(0, 24),
      signal,
      emit,
      beforeModelCall,
    });
    emit({ type: 'plan.ready', plan });

    if (plan.route === 'answer') {
      emit({ type: 'mission.status', status: 'synthesizing' });
      // 계획에 실패해 물러났다면 그 사실을 답변 맨 앞에 밝힌다.
      const note = plan.degraded ? `${PLAN_FALLBACK_NOTE}\n\n` : '';
      if (note) emit({ type: 'answer.delta', delta: note });
      const text = await streamConductor(client, conductorModel, {
        system: CONDUCTOR_ANSWER_SYSTEM,
        effort: ANSWER_EFFORT,
        userMessage: [preamble, earlier, safeGoal].filter(Boolean).join('\n\n'),
        signal,
        emit,
        beforeModelCall,
      });
      if (!text.trim()) throw new EmptyResponseError();
      emit({ type: 'answer.done', text: note + text });
      return 'done';
    }

    if (settings.reviewPlans) {
      const approved = await this.reviewPlan(plan, emit, signal);
      if (signal.aborted) return 'cancelled';
      if (!approved) return 'cancelled';
    }

    emit({ type: 'mission.status', status: 'running' });
    const outcomes = await this.runSteps(plan, {
      client,
      settings,
      goal: safeGoal,
      preamble,
      earlier,
      // 리서처는 웹으로 나가므로 이름, 기억, 이전 턴을 프롬프트에 넣지 않는다.
      researcherPreamble: buildPreamble({ displayName: '' }, []),
      carriedTaint,
      emit,
      signal,
      budget,
    });
    if (signal.aborted) return 'cancelled';

    const results = plan.steps.map((s) => ({ step: s, outcome: outcomes.get(s.id)! }));
    const budgetHit = results.find((r) => r.outcome.error?.code === 'budget_exceeded');
    if (budgetHit?.outcome.error) {
      // 예산을 넘으면 새 호출을 하지 않는다. 지금까지의 결과는 단계별로 그대로 남는다.
      emit({ type: 'mission.error', code: 'budget_exceeded', message: budgetHit.outcome.error.message });
      return 'failed';
    }

    const finished = results.filter((r) => r.outcome.status === 'done');
    if (finished.length === 0) {
      const firstFailure = results.find((r) => r.outcome.error)?.outcome.error;
      emit({
        type: 'mission.error',
        code: firstFailure?.code ?? 'internal',
        message: firstFailure?.message ?? '어떤 단계도 끝내지 못했어요. 다시 시도해 주세요.',
      });
      return 'failed';
    }

    if (plan.steps.length === 1) {
      emit({ type: 'answer.done', text: finished[0].outcome.output ?? '' });
      return 'done';
    }

    const finishedReports = finished.map((r) => r.outcome.output ?? '').join('\n\n');

    emit({ type: 'mission.status', status: 'synthesizing' });
    const reports = results.map(({ step, outcome }) => {
      if (outcome.status === 'done') return wrapUpstream(step.agent, step.id, outcome.output ?? '');
      const partial = outcome.output ? `\n지금까지의 결과:\n${outcome.output}` : '';
      return wrapUpstream(step.agent, step.id, `이 단계(${step.title})는 완료되지 않았습니다: ${outcome.error?.message ?? '선행 단계 실패로 건너뜀'}${partial}`);
    });
    const text = await streamConductor(client, conductorModel, {
      system: CONDUCTOR_SYNTH_SYSTEM,
      effort: SYNTH_EFFORT,
      userMessage: [preamble, earlier, `<mission_goal>\n${safeGoal}\n</mission_goal>`, ...reports].filter(Boolean).join('\n\n'),
      signal,
      emit,
      beforeModelCall,
    });
    // 종합이 비어 돌아오면 단계 결과를 그대로 보여준다.
    emit({ type: 'answer.done', text: text.trim() ? text : finishedReports });
    return 'done';
  }

  private async reviewPlan(plan: MissionPlan, emit: Emit, signal: AbortSignal): Promise<boolean> {
    const approval: ApprovalRequest = {
      id: newId('ap'),
      kind: 'plan',
      agent: 'conductor',
      summary: `${plan.title}: ${plan.steps.length}단계로 진행할까요?`,
      risk: 'safe',
      reason: '설정에서 실행 전 계획 검토를 켰어요.',
      requestedAt: Date.now(),
    };
    emit({ type: 'mission.status', status: 'awaiting_plan' });
    return (await this.askApproval(approval, emit, signal)) === 'approve';
  }

  /** 의존성 순서대로 실행한다. 준비된 단계는 최대 3개까지 동시에 달린다. */
  private async runSteps(
    plan: MissionPlan,
    ctx: {
      client: LlmClient;
      settings: Settings;
      goal: string;
      preamble: string;
      earlier: string;
      researcherPreamble: string;
      carriedTaint: boolean;
      emit: Emit;
      signal: AbortSignal;
      budget: BudgetGuard;
    }
  ): Promise<Map<string, StepOutcome>> {
    const { emit, signal } = ctx;
    const outcomes = new Map<string, StepOutcome>();
    const running = new Map<string, Promise<void>>();
    const pending = new Set(plan.steps.map((s) => s.id));
    const byId = new Map(plan.steps.map((s) => [s.id, s]));
    const single = plan.steps.length === 1;
    let budgetHit = false;

    const runOne = async (step: PlanStep) => {
      const deps = step.dependsOn.map((d) => ({ step: byId.get(d)!, outcome: outcomes.get(d)! }));
      const tainted = ctx.carriedTaint || deps.some((d) => d.outcome.tainted);
      emit({ type: 'step.started', stepId: step.id });
      if (tainted) emit({ type: 'step.tainted', stepId: step.id });
      try {
        const { output, tainted: finalTaint } = await runStep(
          {
            missionId: this.id,
            client: ctx.client,
            model: modelFor(step.agent, ctx.settings.modelPreset),
            signal,
            emit,
            beforeModelCall: (estimate) => ctx.budget.acquire(signal, { estimate, parallelism: Math.min(MAX_CONCURRENT_STEPS, plan.steps.length) }),
            askApproval: (approval, input) => this.askApproval(approval, emit, signal, input),
          },
          step,
          {
            userMessage: stepMessage(step, ctx, deps, single),
            tainted,
            streamAsAnswer: single,
            upstreamText: deps.map((d) => d.outcome.output ?? '').filter(Boolean).join('\n\n'),
          }
        );
        outcomes.set(step.id, { status: 'done', output, tainted: finalTaint });
        emit({ type: 'step.finished', stepId: step.id, status: 'done', output });
      } catch (err) {
        if (isCancellation(err) || signal.aborted) {
          outcomes.set(step.id, { status: 'cancelled', tainted });
          emit({ type: 'step.finished', stepId: step.id, status: 'cancelled' });
          return;
        }
        if (err instanceof BudgetExceededError) budgetHit = true;
        const described = describeError(err);
        // 턴 한도나 잘림으로 멈춰도 그때까지의 결과는 남긴다.
        const partial = err instanceof IncompleteRunError && err.partialText ? err.partialText : undefined;
        outcomes.set(step.id, { status: 'failed', tainted, error: described, output: partial });
        if (single) {
          if (err instanceof RefusedError) emit({ type: 'answer.done', text: '', clear: true });
          else if (partial) emit({ type: 'answer.done', text: partial });
        }
        emit({ type: 'step.finished', stepId: step.id, status: 'failed', error: described.message, output: partial });
      }
    };

    const skipBlocked = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const id of pending) {
          const step = byId.get(id)!;
          const blocked = step.dependsOn.some((d) => {
            const s = outcomes.get(d)?.status;
            return s === 'failed' || s === 'skipped' || s === 'cancelled';
          });
          if (blocked || budgetHit) {
            pending.delete(id);
            outcomes.set(id, { status: 'skipped', tainted: false });
            emit({ type: 'step.finished', stepId: id, status: 'skipped' });
            changed = true;
          }
        }
      }
    };

    while (!signal.aborted) {
      skipBlocked();
      for (const id of [...pending]) {
        if (running.size >= MAX_CONCURRENT_STEPS) break;
        const step = byId.get(id)!;
        if (step.dependsOn.every((d) => outcomes.get(d)?.status === 'done')) {
          pending.delete(id);
          running.set(id, runOne(step).finally(() => running.delete(id)));
        }
      }
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
    return outcomes;
  }
}

function stepMessage(
  step: PlanStep,
  ctx: { goal: string; preamble: string; earlier: string; researcherPreamble: string },
  deps: { step: PlanStep; outcome: StepOutcome }[],
  direct: boolean
): string {
  const researcher = step.agent === 'researcher';
  const parts = [
    researcher ? ctx.researcherPreamble : ctx.preamble,
    researcher ? '' : ctx.earlier,
    `<mission_goal>\n${ctx.goal}\n</mission_goal>`,
    `<your_task>\n${neutralizeTags(step.task)}\n</your_task>`,
    ...deps.map((d) => wrapUpstream(d.step.agent, d.step.id, d.outcome.output ?? '')),
  ];
  if (direct) {
    parts.push('This is the only step, so your last message goes straight to the user. Write it as your reply to them.');
  }
  return parts.filter(Boolean).join('\n\n');
}

async function makePlanWithEvents(
  client: LlmClient,
  model: string,
  input: {
    userMessage: string;
    fallbackTitle: string;
    signal: AbortSignal;
    emit: Emit;
    beforeModelCall: AgentHooks['beforeModelCall'];
  }
): Promise<MissionPlan> {
  const coalescer = new DeltaCoalescer({
    onThinking: (delta) => input.emit({ type: 'conductor.thinking', delta }),
    onText: () => undefined,
  });
  try {
    return await makePlan({
      client,
      model,
      userMessage: input.userMessage,
      fallbackTitle: input.fallbackTitle,
      signal: input.signal,
      beforeModelCall: input.beforeModelCall,
      onUsage: (served, delta) => input.emit({ type: 'usage', model: served, delta }),
      onThinking: (delta) => coalescer.pushThinking(delta),
      onRollback: ({ thinking }) => {
        coalescer.flush();
        input.emit({ type: 'answer.rollback', textChars: 0, thinkingChars: thinking });
      },
    });
  } finally {
    coalescer.flush();
  }
}

/**
 * 지휘자의 직접 답변과 종합. 도구 없이 답변을 스트리밍한다.
 * 스트림 재시도, 거절, 빈 응답, 사용량 기록은 단계와 같은 루프를 쓴다.
 */
async function streamConductor(
  client: LlmClient,
  model: string,
  input: {
    system: string;
    effort: Effort;
    userMessage: string;
    signal: AbortSignal;
    emit: Emit;
    beforeModelCall: AgentHooks['beforeModelCall'];
  }
): Promise<string> {
  const result = await runAgentLoop({
    client,
    model,
    effort: input.effort,
    maxTokens: ANSWER_MAX_TOKENS,
    system: input.system,
    tools: [],
    messages: [{ role: 'user', content: input.userMessage }],
    signal: input.signal,
    hooks: {
      beforeModelCall: input.beforeModelCall,
      onUsage: (served, delta) => input.emit({ type: 'usage', model: served, delta }),
      onThinking: (delta) => input.emit({ type: 'conductor.thinking', delta }),
      onText: (delta) => input.emit({ type: 'answer.delta', delta }),
      onRollback: ({ text, thinking }) => input.emit({ type: 'answer.rollback', textChars: text, thinkingChars: thinking }),
      onActivity: () => undefined,
      onServerToolStart: () => undefined,
      onServerToolFinish: () => undefined,
      runClientTools: async () => [],
    },
  });
  return result.truncated && result.text.trim() ? result.text + TRUNCATED_NOTE : result.text;
}

// ─── 레지스트리 ──────────────────────────────────────────────
interface Registry {
  live: Map<string, Mission>;
  /** 메모리에 없는 끝난 미션의 요약 */
  summaries: Map<string, MissionSummary>;
  ready: Promise<void> | null;
}

/** HMR과 라우트별 번들 분리에도 하나만 존재하도록 globalThis에 둔다. */
const holder = globalThis as unknown as { __illionaireMissions?: Registry };
const registry: Registry = (holder.__illionaireMissions ??= { live: new Map(), summaries: new Map(), ready: null });

/** 프로세스 시작 후 첫 접근 때 디스크를 읽는다. 끝나지 않은 미션은 이어갈 수 없으므로 실패로 닫는다. */
function ensureLoaded(): Promise<void> {
  registry.ready ??= (async () => {
    for (const id of await listStoredMissionIds()) {
      try {
        if (registry.live.has(id)) continue;
        const events = await loadEvents(id);
        const view = replayEvents(events) ?? (await loadSnapshot(id));
        if (!view) continue;
        if (isTerminal(view.status)) {
          registry.summaries.set(id, summaryOf(view));
          await settlePendingInputs(id, []);
          continue;
        }
        await repairEventLogTail(id);
        const interrupted = await settlePendingInputs(id, view.approvals.map((a) => a.id));
        const mission = new Mission(id);
        mission.restore(events, view);
        mission.closeAfterRestart(interrupted);
        await mission.flush();
        registry.summaries.set(id, summaryOf(mission.view));
      } catch (err) {
        console.error('[mission] 불러오기 실패', id, err);
      }
    }
  })();
  // 일시적인 읽기 실패로 이후 모든 요청이 막히지 않도록 다음 접근에서 다시 시도한다.
  registry.ready.catch(() => {
    registry.ready = null;
  });
  return registry.ready;
}

function onMissionSettled(mission: Mission) {
  registry.summaries.set(mission.id, summaryOf(mission.view));
  const finished = [...registry.live.values()].filter((m) => m.terminal);
  if (finished.length > MAX_FINISHED_IN_MEMORY) {
    finished
      .sort((a, b) => a.view.updatedAt - b.view.updatedAt)
      .slice(0, finished.length - MAX_FINISHED_IN_MEMORY)
      .forEach((m) => registry.live.delete(m.id));
  }
}

async function loadMission(id: string): Promise<Mission | null> {
  if (!isMissionId(id)) return null;
  await ensureLoaded();
  const live = registry.live.get(id);
  if (live) return live;
  const events = await loadEvents(id);
  const view = replayEvents(events);
  if (!view) return null;
  const mission = new Mission(id);
  mission.restore(events, view);
  registry.live.set(id, mission);
  return mission;
}

function validateGoal(goal: unknown): string {
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new ApiError(400, 'invalid_goal', '무엇을 할지 입력해 주세요.');
  }
  if (goal.length > MAX_GOAL_CHARS) {
    throw new ApiError(400, 'goal_too_long', `요청은 ${MAX_GOAL_CHARS.toLocaleString()}자까지 입력할 수 있어요.`);
  }
  return goal.trim();
}

export async function createMission(rawGoal: unknown): Promise<string> {
  const goal = validateGoal(rawGoal);
  await ensureLoaded();
  const active = [...registry.live.values()].filter((m) => !m.terminal).length;
  if (active >= MAX_ACTIVE_MISSIONS) {
    throw new ApiError(429, 'too_many_missions', `동시에 진행할 수 있는 미션은 ${MAX_ACTIVE_MISSIONS}개예요. 진행 중인 미션이 끝난 뒤에 다시 시도해 주세요.`);
  }
  const [mode, settings] = await Promise.all([missionMode(), getSettings()]);
  const id = newId('m');
  const mission = new Mission(id);
  registry.live.set(id, mission);
  mission.emit({
    type: 'mission.created',
    id,
    goal,
    mode,
    budgetUsd: settings.budgetUsd,
  });
  mission.start(goal);
  return id;
}

/** 키가 없는 것과 있는데 지금 못 읽는 것은 다르다. 후자를 데모로 돌리면 사용자는 가짜 결과를 진짜로 받는다. */
async function missionMode(): Promise<'live' | 'demo'> {
  if (await getApiKey()) return 'live';
  if ((await apiKeyInfo()).storage === 'unreadable') {
    throw new ApiError(503, 'key_unreadable', '저장된 API 키를 지금 읽지 못했어요. 잠시 후 다시 시도하거나 설정에서 키를 다시 등록해 주세요.');
  }
  return 'demo';
}

export async function followupMission(id: string, rawGoal: unknown): Promise<boolean> {
  const goal = validateGoal(rawGoal);
  const mission = await loadMission(id);
  if (!mission) return false;
  const activeError = () => new ApiError(409, 'mission_active', '아직 진행 중인 미션이에요. 끝난 뒤에 이어서 지시해 주세요.');
  if (!mission.terminal) throw activeError();
  // 상한을 올렸거나 키를 등록했다면 이번 턴부터 적용한다.
  const [mode, settings] = await Promise.all([missionMode(), getSettings()]);
  // 끊긴 승인의 입력은 사용자가 이어갈지 정할 때까지만 남겨 둔다.
  await removeInterruptedInputs(id);
  // 이 확인과 시작 사이에 await를 두지 않는다. 동시에 온 지시가 둘 다 지나가면 실행이 둘이 된다.
  if (!mission.terminal) throw activeError();
  mission.followup(goal, { budgetUsd: settings.budgetUsd, mode });
  return true;
}

export async function getMissionView(id: string): Promise<MissionView | null> {
  if (!isMissionId(id)) return null;
  await ensureLoaded();
  const view = registry.live.get(id)?.view ?? (await loadSnapshot(id)) ?? replayEvents(await loadEvents(id));
  return view && withInterruptedInputs(view, await loadPendingInputs(id));
}

export async function listMissionSummaries(): Promise<MissionSummary[]> {
  await ensureLoaded();
  const merged = new Map(registry.summaries);
  for (const [id, m] of registry.live) merged.set(id, summaryOf(m.view));
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LISTED);
}

/** 진행 중이면 취소, 끝났으면 삭제. 없는 미션이면 false. */
export async function cancelOrDeleteMission(id: string): Promise<boolean> {
  const mission = await loadMission(id);
  if (!mission) return false;
  if (!mission.terminal) {
    mission.cancel();
    return true;
  }
  await mission.quiesce();
  // 기다리는 사이 후속 지시가 시작됐으면 그것까지 멈춘 뒤 지운다.
  if (!mission.terminal) {
    mission.cancel();
    await mission.quiesce();
  }
  registry.live.delete(id);
  registry.summaries.delete(id);
  await deleteStoredMission(id);
  return true;
}

export async function decideApproval(
  id: string,
  approvalId: string,
  decision: ApprovalDecision,
  remember: boolean
): Promise<boolean> {
  if (!isMissionId(id)) return false;
  await ensureLoaded();
  const mission = registry.live.get(id);
  if (!mission) return false;
  return mission.decide(approvalId, decision, remember);
}

export interface MissionEventFeed {
  /**
   * since 이후의 이벤트를 재생하고 이어서 실시간으로 전달한다.
   * 재생과 구독이 같은 틱에 일어나므로 사이에 빠지는 이벤트가 없다.
   */
  attach: (since: number, fn: (event: MissionEvent) => void) => () => void;
  isTerminal: () => boolean;
}

export async function openMissionFeed(id: string): Promise<MissionEventFeed | null> {
  const mission = await loadMission(id);
  if (!mission) return null;
  return {
    attach(since, fn) {
      const unsubscribe = mission.subscribe(fn);
      for (const event of mission.events) {
        if (event.seq > since) fn(event);
      }
      return unsubscribe;
    },
    isTerminal: () => mission.terminal,
  };
}

/** 전체 데이터 삭제 전에 진행 중인 미션을 멈추고 메모리에서 지운다. 끝난 쓰기가 파일을 되살리지 않도록 기다린다. */
export async function purgeAllMissions(): Promise<void> {
  const missions = [...registry.live.values()];
  for (const mission of missions) {
    if (!mission.terminal) mission.cancel();
  }
  await Promise.all(missions.map((m) => m.quiesce().catch(() => undefined)));
  registry.live.clear();
  registry.summaries.clear();
  registry.ready = null;
}

/** 현재 실행이 끝날 때까지 기다린다 (테스트용). */
export async function waitForMission(id: string): Promise<MissionView | null> {
  const mission = registry.live.get(id);
  if (!mission) return null;
  await mission.settled;
  return mission.view;
}

/** 테스트 사이에 전역 상태를 지운다. */
export function resetMissionRegistryForTests() {
  registry.live.clear();
  registry.summaries.clear();
  registry.ready = null;
}
