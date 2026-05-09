/**
 * Tool registry — Claude tool-use 스키마 + 위험 등급 + 핸들러.
 *
 * risk:
 *  - 'safe'    : 즉시 실행. 부수효과 없음 또는 무시 가능 (getter, 표시용)
 *  - 'confirm' : 시스템/파일 상태를 변경 → 사용자 승인 필요
 *  - 'danger'  : 데이터 손실 가능성 (파일 삭제 등) → 강한 경고
 */
export type ToolRisk = 'safe' | 'confirm' | 'danger';

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  risk: ToolRisk;
  /** 사용자에게 보여줄 사람-읽기용 요약 (확인 카드 본문) */
  summarize: (input: I) => string;
  /** Claude tool input_schema (JSON Schema) */
  schema: Record<string, unknown>;
  /** 실제 실행. 결과 문자열은 그대로 Claude tool_result로 전달됨 */
  run: (input: I) => Promise<string>;
}

const REGISTRY = new Map<string, ToolDef<any>>();

export function register<T>(def: ToolDef<T>) {
  REGISTRY.set(def.name, def as ToolDef<unknown>);
}

export function getTool(name: string): ToolDef<unknown> | undefined {
  return REGISTRY.get(name);
}

export function listTools(): ToolDef<unknown>[] {
  return Array.from(REGISTRY.values());
}

/** Claude SDK가 받는 tools 배열 형태로 직렬화 */
export function asAnthropicTools() {
  return listTools().map((t) => ({
    name: t.name,
    description: `[${t.risk}] ${t.description}`,
    input_schema: t.schema,
  }));
}
