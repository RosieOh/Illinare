import type { AgentId, MissionPlan, PlanStep } from '@/lib/contracts';
import { AGENTS } from '@/lib/contracts';
import { runAgentLoop, type AgentHooks, type AgentRunResult } from './agent-loop';
import type { Effort, LlmClient, MessageParam } from './llm';
import { CONDUCTOR_PLAN_SYSTEM, PLAN_EFFORT } from './roster';
import type { UsageTotals } from '@/lib/contracts';

export const MAX_PLAN_STEPS = 6;
/** 추론까지 포함한 상한. 작으면 계획이 잘려 도구 없는 답변으로 물러나게 된다. */
const PLAN_MAX_TOKENS = 32_000;

/** 계획을 끝내 세우지 못했을 때 사용자에게 보여주는 문구 */
export const PLAN_FALLBACK_NOTE = '계획을 제대로 세우지 못해 도구 없이 답했어요. 파일이나 웹이 필요한 일이라면 다시 요청해 주세요.';

const SPECIALIST_IDS = (Object.keys(AGENTS) as AgentId[]).filter(
  (a): a is PlanStep['agent'] => a !== 'conductor'
);

/** structured outputs 스키마. 모든 속성이 required이고 additionalProperties가 false여야 한다. */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    route: { type: 'string', enum: ['answer', 'team'] },
    rationale: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          agent: { type: 'string', enum: SPECIALIST_IDS },
          title: { type: 'string' },
          task: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'agent', 'title', 'task', 'dependsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'route', 'rationale', 'steps'],
  additionalProperties: false,
};

export type PlanValidation = { ok: true; plan: MissionPlan } | { ok: false; error: string };

/** 계획을 신뢰하지 않고 검사한다: 알려진 에이전트, 고유 id, 존재하는 의존성, 순환 없음. */
export function validatePlan(raw: unknown): PlanValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'plan is not an object' };
  const p = raw as Partial<MissionPlan> & { steps?: unknown };
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title) return { ok: false, error: 'title is empty' };
  if (p.route !== 'answer' && p.route !== 'team') return { ok: false, error: 'route must be "answer" or "team"' };
  const rationale = typeof p.rationale === 'string' ? p.rationale : undefined;

  if (p.route === 'answer') return { ok: true, plan: { title, route: 'answer', steps: [], rationale } };

  if (!Array.isArray(p.steps) || p.steps.length === 0) return { ok: false, error: 'team plan needs at least one step' };
  if (p.steps.length > MAX_PLAN_STEPS) return { ok: false, error: `at most ${MAX_PLAN_STEPS} steps are allowed` };

  const steps: PlanStep[] = [];
  const ids = new Set<string>();
  for (const s of p.steps as Partial<PlanStep>[]) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) return { ok: false, error: 'a step has no id' };
    if (ids.has(s.id)) return { ok: false, error: `duplicate step id ${s.id}` };
    ids.add(s.id);
    if (typeof s.agent !== 'string' || !SPECIALIST_IDS.includes(s.agent as PlanStep['agent'])) {
      return { ok: false, error: `step ${s.id} has unknown agent ${String(s.agent)}` };
    }
    if (typeof s.task !== 'string' || !s.task.trim()) return { ok: false, error: `step ${s.id} has no task` };
    steps.push({
      id: s.id,
      agent: s.agent as PlanStep['agent'],
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : AGENTS[s.agent as AgentId].name,
      task: s.task,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter((d): d is string => typeof d === 'string') : [],
    });
  }

  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) return { ok: false, error: `step ${s.id} depends on unknown step ${dep}` };
    }
  }
  if (hasCycle(steps)) return { ok: false, error: 'dependsOn has a cycle' };

  return { ok: true, plan: { title, route: 'team', steps, rationale } };
}

function hasCycle(steps: PlanStep[]): boolean {
  const remaining = new Map(steps.map((s) => [s.id, new Set(s.dependsOn)]));
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id);
    if (ready.length === 0) return true;
    for (const id of ready) {
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return false;
}

export interface PlanInput {
  client: LlmClient;
  model: string;
  /** 머리말 + 이전 턴 + 목표를 담은 첫 사용자 메시지 */
  userMessage: string;
  fallbackTitle: string;
  signal: AbortSignal;
  beforeModelCall: AgentHooks['beforeModelCall'];
  onUsage: (model: string, delta: UsageTotals) => void;
  onThinking: (delta: string) => void;
  onRollback?: AgentHooks['onRollback'];
}

function requestPlan(input: PlanInput, messages: MessageParam[], effort: Effort): Promise<AgentRunResult> {
  // 스트림 재시도, 거절, 사용량 기록은 일반 단계와 같은 루프를 쓴다.
  return runAgentLoop({
    client: input.client,
    model: input.model,
    effort,
    maxTokens: PLAN_MAX_TOKENS,
    system: CONDUCTOR_PLAN_SYSTEM,
    tools: [],
    messages,
    signal: input.signal,
    format: PLAN_SCHEMA,
    nudgeEmpty: false,
    hooks: {
      beforeModelCall: input.beforeModelCall,
      onUsage: input.onUsage,
      onThinking: input.onThinking,
      onText: () => undefined,
      onRollback: input.onRollback,
      onActivity: () => undefined,
      onServerToolStart: () => undefined,
      onServerToolFinish: () => undefined,
      runClientTools: async () => [],
    },
  });
}

function parsePlanText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 지휘자에게 계획을 받는다. 잘못된 계획은 이유를 알려주고 한 번 다시 받고,
 * 그래도 잘못되면 도구 없는 직접 답변으로 물러선다 (부수효과가 없는 쪽).
 * 물러났다는 사실은 숨기지 않고 degraded로 알린다.
 */
export async function makePlan(input: PlanInput): Promise<MissionPlan> {
  const initial: MessageParam[] = [{ role: 'user', content: input.userMessage }];
  const first = await requestPlan(input, initial, PLAN_EFFORT);
  const firstCheck = validatePlan(parsePlanText(first.text));
  if (firstCheck.ok) return firstCheck.plan;

  // 잘린 계획은 고칠 내용이 없다. 추론을 줄여 처음부터 다시 받는다.
  const canCorrect = !first.truncated && first.content.some((b) => b.type === 'text');
  const second = await requestPlan(
    input,
    canCorrect
      ? [
          ...initial,
          { role: 'assistant', content: first.content },
          { role: 'user', content: `That plan is invalid: ${firstCheck.error}. Return a corrected plan.` },
        ]
      : initial,
    canCorrect ? PLAN_EFFORT : 'low'
  );
  const secondCheck = validatePlan(parsePlanText(second.text));
  if (secondCheck.ok) return secondCheck.plan;

  return { title: input.fallbackTitle, route: 'answer', steps: [], rationale: PLAN_FALLBACK_NOTE, degraded: true };
}
