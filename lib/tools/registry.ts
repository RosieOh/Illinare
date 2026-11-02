import type { AgentId, ApprovalPreview, MissionArtifact, ToolInfo, ToolRisk } from '@/lib/contracts';
import { displayPreview, displaySummary } from './display';

/**
 * Tool registry — Claude tool-use 스키마 + 위험 등급 + 핸들러.
 *
 * risk:
 *  - 'safe'    : 즉시 실행. 부수효과 없음 또는 무시 가능 (getter, 표시용)
 *  - 'confirm' : 시스템/파일 상태를 변경 → 사용자 승인 필요
 *  - 'danger'  : 데이터 손실 가능성 (파일 삭제 등) → 강한 경고
 */
export type { ToolRisk };

export interface ToolContext {
  missionId?: string;
  agent?: AgentId;
  signal?: AbortSignal;
  /** 도구가 만든 산출물을 미션에 알린다 (노트, 덱, 할 일 등) */
  emitArtifact?: (artifact: MissionArtifact) => void;
}

/** run()이 문자열 대신 돌려줄 수 있는 자세한 결과 */
export interface ToolOutcome {
  content: string;
  /** 저널에 되돌리기 정보가 있으면 그 id */
  journalId?: string;
  /** 모델이 직접 읽을 첨부 (PDF, 이미지). 감사 기록과 이벤트에는 남기지 않는다. */
  attachment?: ToolAttachment;
}

export type ToolAttachment =
  | { kind: 'pdf'; name: string; data: string }
  | { kind: 'image'; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string };

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  risk: ToolRisk;
  group: ToolInfo['group'];
  /** 이 도구를 쓸 수 있는 에이전트 — 최소 권한의 기준 */
  agents: AgentId[];
  /** 사용자에게 보여줄 사람-읽기용 요약 (승인 카드 본문) */
  summarize: (input: I) => string;
  /** Claude tool input_schema (JSON Schema) */
  schema: Record<string, unknown>;
  /** 실제 실행. 결과 문자열은 tool_result로 전달된다. */
  run: (input: I, ctx: ToolContext) => Promise<string | ToolOutcome>;
  /** 이 OS에서 동작하는가. 생략하면 항상 true. */
  available?: () => boolean;
  /** 신뢰할 수 없는 외부 데이터를 호출자에게 전달하는가 (파일, 클립보드 등). 호출자를 오염 상태로 만든다. */
  readsUntrusted?: boolean;
  /** 입력 일부를 기기 밖으로 내보내는가 (네트워크 요청). 오염 상태에서는 승인 필요. */
  egress?: boolean;
  /** 승인 카드에 보여줄 미리보기 (쓰기 전 diff 등) */
  preview?: (input: I) => Promise<ApprovalPreview | undefined>;
  /** 입력에 따라 위험 등급이 달라지는 도구. policy.gate가 사용한다. */
  riskFor?: (input: I) => ToolRisk;
  /** 위험 등급이 safe여도 사용자에게 보이는 흔적을 남긴다 (알림, 할 일, 문서 등). 오염 상태에서는 승인 필요. */
  sideEffect?: boolean;
}

const REGISTRY = new Map<string, ToolDef<unknown>>();

/** 모든 도구의 요약과 미리보기는 보이지 않는 문자를 드러낸 뒤에 나간다. */
export function register<T>(def: ToolDef<T>) {
  const { summarize, preview } = def;
  const shown: ToolDef<T> = {
    ...def,
    summarize: (input) => displaySummary(summarize(input)),
    preview: preview
      ? async (input) => {
          const result = await preview(input);
          return result && displayPreview(result);
        }
      : undefined,
  };
  REGISTRY.set(def.name, shown as unknown as ToolDef<unknown>);
}

export function getTool(name: string): ToolDef<unknown> | undefined {
  return REGISTRY.get(name);
}

/** 이름순 정렬 — 프롬프트 캐시가 깨지지 않도록 순서를 고정한다. */
export function listTools(): ToolDef<unknown>[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function isAvailable(tool: ToolDef<unknown>): boolean {
  return tool.available ? tool.available() : true;
}

export function toolsForAgent(agent: AgentId): ToolDef<unknown>[] {
  return listTools().filter((t) => t.agents.includes(agent) && isAvailable(t));
}
