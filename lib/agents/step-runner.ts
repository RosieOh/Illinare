import '@/lib/tools';
import type {
  AgentId,
  ApprovalDecision,
  ApprovalRequest,
  AuditEntry,
  MissionEventBody,
  PlanStep,
  ToolCallView,
  ToolRisk,
} from '@/lib/contracts';
import { appendAudit } from '@/lib/store/audit';
import { getSettings } from '@/lib/store/settings';
import { newId } from '@/lib/store/json';
import { anthropicToolsFor } from '@/lib/tools/anthropic';
import { executeTool, recordDenied } from '@/lib/tools/execute';
import { effectiveRisk, gate } from '@/lib/tools/policy';
import { displaySummary } from '@/lib/tools/display';
import { getTool, type ToolContext, type ToolDef } from '@/lib/tools/registry';
import { validateInput } from '@/lib/tools/validate';
import { runAgentLoop, type AgentHooks } from './agent-loop';
import { WEB_ACCESS_APPROVAL } from './approvals';
import { compactResult, recordedInput, withAttachment, wrapToolOutput } from './context';
import { CancelledError, EmptyResponseError } from './errors';
import type { LlmClient, ToolResultBlockParam, ToolUnion, ToolUseBlock } from './llm';
import { SPECIALISTS, UNTRUSTED_SERVER_TOOLS } from './roster';

const STEP_MAX_TOKENS = 64_000;

const DENIED_TEXT = '사용자가 이 작업을 거부했습니다. 같은 작업을 다시 시도하지 말고, 이 부분 없이 진행하면서 하지 못한 일을 보고하세요.';
const READ_RESULT_HIDDEN = '내용을 읽었어요. 파일과 클립보드 내용은 기록에 남기지 않아요.';
const NO_SUMMARY_OUTPUT = '작업을 마쳤지만 결과 요약을 받지 못했어요. 단계 기록을 확인해 주세요.';
const WEB_ACCESS_REASON =
  '이 단계는 내 파일이나 외부에서 읽은 내용을 본 뒤 웹으로 요청을 보내요. 그 내용이 검색어나 주소에 실려 밖으로 나갈 수 있어 먼저 확인해요.';
const WEB_ACCESS_DENIED_NOTE =
  'The user did not allow web access for this step, so web_search and web_fetch are not available. Do not try to reach the web. Work only from the material above and report what you could not do.';
const WEB_ACCESS_PREVIEW_CHARS = 4000;

export interface StepEnv {
  missionId: string;
  client: LlmClient;
  model: string;
  signal: AbortSignal;
  emit: (body: MissionEventBody) => void;
  /** 모델 호출 직전. 예산을 넘었으면 throw */
  beforeModelCall: AgentHooks['beforeModelCall'];
  /** input은 승인을 기다리는 동안만 보관할 도구 입력 원문이다. */
  askApproval: (approval: ApprovalRequest, input?: unknown) => Promise<ApprovalDecision>;
}

export interface StepOptions {
  userMessage: string;
  /** 의존한 단계가 오염됐으면 true로 시작한다 */
  tainted: boolean;
  /** 결과를 그대로 사용자 답변으로 쓴다 (단일 단계 계획) */
  streamAsAnswer: boolean;
  /** 이 단계가 보게 될 이전 단계 결과. 웹 접근 승인 카드에 보여준다. */
  upstreamText?: string;
}

export interface StepResult {
  output: string;
  tainted: boolean;
}

interface Decision {
  block: ToolUseBlock;
  tool: ToolDef<unknown>;
  input: Record<string, unknown>;
  summary: string;
  action: 'run' | 'ask';
  /** 입력을 반영한 위험 등급 */
  risk: ToolRisk;
  reason: string;
  /** 판단 시점의 오염 여부. 같은 턴의 다른 호출 결과는 이 입력을 만들 때 보지 못했다. */
  tainted: boolean;
}

function safeSummary(tool: ToolDef<unknown>, input: unknown): string {
  try {
    return tool.summarize(input);
  } catch {
    return tool.name;
  }
}

/** 이벤트에 남는 요약. 승인 카드만 내용이 든 요약을 본다. */
function safeRecordSummary(tool: ToolDef<unknown>, input: unknown): string {
  try {
    return (tool.recordSummary ?? tool.summarize)(input);
  } catch {
    return tool.name;
  }
}

/** 사용자가 웹 호출을 믿고 볼 수 있는 곳이 여기뿐이다. 주소 속 보이지 않는 문자도 드러낸다. */
function serverToolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as { query?: string; url?: string };
  if (name === 'web_search' && i.query) return displaySummary(`웹 검색: ${i.query}`);
  if (name === 'web_fetch' && i.url) return displaySummary(`웹 페이지 읽기: ${i.url}`);
  if (name === 'web_search') return '웹 검색';
  if (name === 'web_fetch') return '웹 페이지 읽기';
  return '샌드박스 코드 실행';
}

export function toolsForStep(agent: Exclude<AgentId, 'conductor'>): ToolUnion[] {
  return [...(anthropicToolsFor(agent) as ToolUnion[]), ...SPECIALISTS[agent].serverTools];
}

/** 전문 에이전트 한 단계를 끝까지 실행한다. 다른 단계는 이 함수와 무관하게 계속 달린다. */
export async function runStep(env: StepEnv, step: PlanStep, options: StepOptions): Promise<StepResult> {
  const { emit, signal } = env;
  const agent = step.agent;
  const profile = SPECIALISTS[agent];
  let tainted = options.tainted;
  let ranTool = false;
  const serverCalls = new Map<string, { name: string; summary: string }>();

  const markTainted = () => {
    if (tainted) return;
    tainted = true;
    emit({ type: 'step.tainted', stepId: step.id });
  };

  const toolContext: ToolContext = {
    missionId: env.missionId,
    agent,
    signal,
    emitArtifact: (artifact) => emit({ type: 'artifact', artifact }),
  };

  /** 서버 측 도구와 웹 접근 승인은 executeTool을 거치지 않으므로 여기서 감사 기록을 남긴다. */
  const audit = async (entry: Pick<AuditEntry, 'tool' | 'summary' | 'risk' | 'status' | 'approvedBy' | 'result'>) => {
    try {
      await appendAudit({ ...entry, missionId: env.missionId, agent, tainted: tainted || undefined });
    } catch (err) {
      console.error('[audit]', err);
    }
  };

  const startCall = (callId: string, name: string, summary: string, input: unknown, risk: ToolRisk, serverSide = false) => {
    const call: ToolCallView = {
      callId,
      stepId: step.id,
      agent,
      name,
      summary,
      input: recordedInput(input),
      risk,
      serverSide: serverSide || undefined,
      status: 'running',
      startedAt: Date.now(),
    };
    emit({ type: 'tool.started', call });
  };

  const finishCall = (
    callId: string,
    status: 'ok' | 'error' | 'denied' | 'blocked',
    result: string,
    undoId?: string
  ) => {
    emit({ type: 'tool.finished', stepId: step.id, callId, status, result: compactResult(result), undoId });
  };

  const toResult = (block: ToolUseBlock, status: string, content: string): ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: block.id,
    content: wrapToolOutput(block.name, status, content),
    ...(status === 'ok' ? {} : { is_error: true }),
  });

  const execute = async (d: Decision, approvedBy: 'auto' | 'user' | 'policy') => {
    if (signal.aborted) throw new CancelledError();
    const outcome = await executeTool(d.block.name, d.input, toolContext, { approvedBy, tainted: d.tainted });
    // 이벤트는 디스크와 내보내기에 남는다. 파일이나 클립보드 본문은 모델에게만 준다.
    const display = outcome.displayContent ?? (d.tool.readsUntrusted && outcome.status === 'ok' ? READ_RESULT_HIDDEN : outcome.content);
    finishCall(d.block.id, outcome.status === 'ok' ? 'ok' : 'error', display, outcome.undoId);
    if (outcome.status === 'ok') ranTool = true;
    if (outcome.status === 'ok' && d.tool.readsUntrusted) markTainted();
    const result = toResult(d.block, outcome.status === 'ok' ? 'ok' : 'error', outcome.content);
    return outcome.attachment ? withAttachment(result, outcome.attachment) : result;
  };

  const askThenRun = async (d: Decision): Promise<ToolResultBlockParam> => {
    if (signal.aborted) throw new CancelledError();
    let preview: ApprovalRequest['preview'];
    try {
      preview = await d.tool.preview?.(d.input);
    } catch {
      preview = undefined;
    }
    let decision: ApprovalDecision;
    try {
      decision = await env.askApproval(
        {
          id: newId('ap'),
          kind: 'tool',
          stepId: step.id,
          agent,
          callId: d.block.id,
          tool: d.block.name,
          summary: d.summary,
          recordSummary: safeRecordSummary(d.tool, d.input),
          risk: d.risk,
          reason: d.reason,
          preview,
          tainted: d.tainted || undefined,
          requestedAt: Date.now(),
        },
        d.input
      );
    } catch (err) {
      finishCall(d.block.id, 'denied', '미션이 취소되어 실행하지 않았어요.');
      throw err;
    }
    if (signal.aborted) throw new CancelledError();
    if (decision === 'deny') {
      await recordDenied(d.block.name, d.input, toolContext, 'denied', d.tainted);
      finishCall(d.block.id, 'denied', '사용자가 거부했어요.');
      return toResult(d.block, 'denied', DENIED_TEXT);
    }
    return execute(d, 'user');
  };

  const runClientTools = async (blocks: ToolUseBlock[]): Promise<ToolResultBlockParam[]> => {
    const settings = await getSettings();
    if (signal.aborted) throw new CancelledError();
    const results = new Map<string, ToolResultBlockParam>();
    const toRun: Decision[] = [];
    const toAsk: Decision[] = [];

    for (const block of blocks) {
      const tool = getTool(block.name);
      // 최소 권한: 이 에이전트에게 주지 않은 도구는 모델이 요청해도 실행하지 않는다.
      if (!tool || !tool.agents.includes(agent)) {
        startCall(block.id, block.name, block.name, block.input, tool?.risk ?? 'danger');
        finishCall(block.id, 'blocked', '이 에이전트가 쓸 수 없는 도구예요.');
        await recordDenied(block.name, block.input, toolContext, 'blocked', tainted);
        results.set(block.id, toResult(block, 'blocked', `이 에이전트는 ${block.name} 도구를 사용할 수 없습니다.`));
        continue;
      }

      const summary = safeSummary(tool, block.input);
      const risk = effectiveRisk(tool, block.input);
      startCall(block.id, block.name, safeRecordSummary(tool, block.input), block.input, risk);

      // 스트리밍 파서는 잘린 입력을 그대로 돌려줄 수 있어 승인 카드에 올리기 전에 검증한다.
      let input: Record<string, unknown>;
      try {
        input = validateInput(tool.schema, block.input);
      } catch (err) {
        const message = err instanceof Error ? err.message : '입력이 올바르지 않습니다';
        finishCall(block.id, 'error', message);
        results.set(block.id, toResult(block, 'error', `입력 검증 실패: ${message}`));
        continue;
      }

      const verdict = gate(tool, { settings, tainted, input });
      if (verdict.action === 'block') {
        finishCall(block.id, 'blocked', verdict.reason);
        await recordDenied(block.name, input, toolContext, 'blocked', tainted);
        results.set(block.id, toResult(block, 'blocked', verdict.reason));
        continue;
      }
      const decision: Decision = { block, tool, input, summary, action: verdict.action, risk, reason: verdict.reason, tainted };
      (verdict.action === 'ask' ? toAsk : toRun).push(decision);
    }

    const runNow = toRun.map(async (d) => {
      results.set(d.block.id, await execute(d, d.risk === 'safe' ? 'auto' : 'policy'));
    });
    // 승인이 필요한 호출은 한 번에 하나씩 묻는다. 승인을 기다리는 동안 안전한 호출은 먼저 끝난다.
    const askInOrder = (async () => {
      for (const d of toAsk) {
        results.set(d.block.id, await askThenRun(d));
      }
    })();
    await Promise.all([...runNow, askInOrder]);

    return blocks.map((b) => results.get(b.id) as ToolResultBlockParam);
  };

  /**
   * 웹 도구는 Anthropic 서버에서 돌아가 gate()를 거치지 않는다. 호출마다 막을 수 없으므로
   * 외부 내용을 본 리서처는 시작 전에 한 번 묻는다. 거부하면 웹 도구 없이 실행한다.
   */
  const askWebAccess = async (): Promise<boolean> => {
    if (signal.aborted) throw new CancelledError();
    const body = `작업:\n${step.task}${options.upstreamText ? `\n\n이 단계가 보게 될 이전 결과:\n${options.upstreamText}` : ''}`;
    const summary = `웹 접근: ${step.title}`;
    const decision = await env.askApproval({
      id: newId('ap'),
      kind: 'tool',
      stepId: step.id,
      agent,
      tool: WEB_ACCESS_APPROVAL,
      summary,
      risk: 'confirm',
      reason: WEB_ACCESS_REASON,
      preview: {
        kind: 'text',
        text: body.slice(0, WEB_ACCESS_PREVIEW_CHARS),
        truncated: body.length > WEB_ACCESS_PREVIEW_CHARS || undefined,
      },
      tainted: true,
      requestedAt: Date.now(),
    });
    if (signal.aborted) throw new CancelledError();
    await audit({ tool: WEB_ACCESS_APPROVAL, summary, risk: 'confirm', status: decision === 'approve' ? 'ok' : 'denied', approvedBy: 'user' });
    return decision === 'approve';
  };

  let tools = toolsForStep(agent);
  let userMessage = options.userMessage;
  let webApproved = false;
  if (agent === 'researcher' && options.tainted) {
    webApproved = await askWebAccess();
    if (!webApproved) {
      tools = tools.filter((t) => !UNTRUSTED_SERVER_TOOLS.includes((t as { name: string }).name));
      userMessage = `${userMessage}\n\n${WEB_ACCESS_DENIED_NOTE}`;
    }
  }

  const result = await runAgentLoop({
    client: env.client,
    model: env.model,
    effort: profile.effort,
    maxTokens: STEP_MAX_TOKENS,
    system: profile.system,
    tools,
    messages: [{ role: 'user', content: userMessage }],
    signal,
    hooks: {
      beforeModelCall: env.beforeModelCall,
      onUsage: (model, delta) => emit({ type: 'usage', stepId: step.id, model, delta }),
      onThinking: (delta) => emit({ type: 'step.thinking', stepId: step.id, delta }),
      onText: (delta) => {
        emit({ type: 'step.text', stepId: step.id, delta });
        if (options.streamAsAnswer) emit({ type: 'answer.delta', delta });
      },
      onRollback: ({ text, thinking }) => {
        emit({ type: 'step.rollback', stepId: step.id, textChars: text, thinkingChars: thinking });
        if (options.streamAsAnswer) emit({ type: 'answer.rollback', textChars: text, thinkingChars: 0 });
      },
      onActivity: (activity) => emit({ type: 'step.activity', stepId: step.id, activity }),
      onServerToolStart: ({ id, name, input }) => {
        const summary = serverToolSummary(name, input);
        serverCalls.set(id, { name, summary });
        startCall(id, name, summary, input, 'safe', true);
        if (UNTRUSTED_SERVER_TOOLS.includes(name)) markTainted();
        void audit({ tool: name, summary, risk: 'safe', status: 'ok', approvedBy: webApproved ? 'user' : 'auto' });
      },
      onServerToolFinish: (id, ok, text) => {
        const call = serverCalls.get(id);
        if (!call) return;
        serverCalls.delete(id);
        if (ok) ranTool = true;
        finishCall(id, ok ? 'ok' : 'error', text);
        // 시작할 때 남긴 기록은 요청이 나갔다는 뜻이다. 실패는 따로 적어 감사 기록만 보고도 알 수 있게 한다.
        if (!ok) void audit({ tool: call.name, summary: call.summary, risk: 'safe', status: 'error', approvedBy: webApproved ? 'user' : 'auto', result: text.slice(0, 300) });
      },
      onUnseenServerCalls: (name, count) => {
        void audit({
          tool: name,
          summary: `응답에 담기지 않은 ${name} 호출 ${count}건 (API 사용량 기준). 검색어나 주소를 알 수 없어요.`,
          risk: 'safe',
          status: 'error',
          approvedBy: webApproved ? 'user' : 'auto',
        });
      },
      runClientTools,
    },
  });

  // 빈 결과를 성공으로 넘기면 답변도 없고 의존 단계도 빈 입력을 받는다.
  if (!result.text.trim()) {
    if (!ranTool) throw new EmptyResponseError();
    return { output: NO_SUMMARY_OUTPUT, tainted };
  }
  const output = result.truncated
    ? `${result.text}\n\n(응답이 길이 제한에 걸려 여기서 끊겼어요.)`
    : result.text;
  return { output, tainted };
}
