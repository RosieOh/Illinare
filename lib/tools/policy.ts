import './index';
import type { Settings, ToolInfo, ToolPolicy, ToolRisk } from '@/lib/contracts';
import { isAvailable, listTools, type ToolDef } from './registry';

export interface GateResult {
  action: 'run' | 'ask' | 'block';
  /** 사용자에게 보여줄 이유 */
  reason: string;
}

export interface GateOptions {
  settings: Settings;
  tainted: boolean;
  /**
   * 도구 입력. 입력에 따라 위험 등급이 달라지는 도구(read_file)에 필요하다.
   * 생략하면 그런 도구는 안전한 쪽으로 판단해 승인을 받는다.
   */
  input?: unknown;
}

/** 입력을 반영한 위험 등급. input이 없으면 입력에 따라 달라지는 도구는 confirm으로 친다. */
export function effectiveRisk(tool: ToolDef<unknown>, input?: unknown): ToolRisk {
  if (!tool.riskFor) return tool.risk;
  if (input === undefined) return tool.risk === 'danger' ? 'danger' : 'confirm';
  try {
    return tool.riskFor(input);
  } catch {
    return 'confirm';
  }
}

const TAINT_REASON =
  '에이전트가 파일이나 웹처럼 외부에서 온 내용을 읽은 뒤 요청한 작업이에요. 그 내용에 숨은 지시일 수 있어 먼저 확인해요.';

/**
 * 승인 판단.
 * 순서: 차단 정책 → danger는 항상 확인 → 오염 + 외부 전송이나 부수효과는 항상 확인 → 'ask' 정책
 * → confirm은 확인('allow'는 오염되지 않았을 때만 통한다) → safe는 실행.
 * 'allow'는 사용자가 직접 시킨 일을 위한 것이다. 에이전트가 외부 내용을 읽은 뒤에는 그 지시가 사용자의 것인지 알 수 없다.
 */
export function gate(tool: ToolDef<unknown>, opts: GateOptions): GateResult {
  const policy: ToolPolicy = opts.settings.toolPolicies[tool.name] ?? 'default';
  if (policy === 'block') {
    return { action: 'block', reason: '설정에서 이 도구를 차단했어요.' };
  }

  const risk = effectiveRisk(tool, opts.input);
  if (risk === 'danger') {
    return { action: 'ask', reason: '되돌리기 어렵거나 진행 중인 작업에 영향을 주는 작업이에요.' };
  }
  if (opts.tainted && (tool.egress || tool.sideEffect)) {
    return { action: 'ask', reason: TAINT_REASON };
  }
  if (policy === 'ask') {
    return { action: 'ask', reason: '설정에서 이 도구를 실행 전에 확인하도록 했어요.' };
  }
  if (risk === 'confirm') {
    if (opts.tainted) return { action: 'ask', reason: TAINT_REASON };
    if (policy === 'allow') return { action: 'run', reason: '설정에서 이 도구를 항상 허용했어요.' };
    return { action: 'ask', reason: '시스템이나 파일 상태를 바꾸거나 민감한 내용을 읽는 작업이에요.' };
  }
  return { action: 'run', reason: '안전한 도구예요.' };
}

/** 설정 화면용 도구 목록. danger 도구의 'allow'는 'ask'로 낮춰 보여준다. */
export function toolInfos(settings: Settings): ToolInfo[] {
  return listTools().map((tool) => {
    const saved = settings.toolPolicies[tool.name] ?? 'default';
    return {
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      group: tool.group,
      agents: tool.agents,
      available: isAvailable(tool),
      policy: tool.risk === 'danger' && saved === 'allow' ? 'ask' : saved,
    };
  });
}
