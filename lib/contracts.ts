/**
 * 공유 계약 — 서버, 클라이언트, 데모 런타임이 모두 이 타입만 바라본다.
 * 런타임 코드 없이 타입과 상수만 둔다 (클라이언트 번들에 안전하게 import 가능).
 */

// ─── 브랜드 ──────────────────────────────────────────────────
export const BRAND = {
  name: '일리네어',
  nameEn: 'Illionaire',
  version: '0.9.0',
  tagline: '내 컴퓨터에서 일하는 AI 팀',
} as const;

// ─── 에이전트 ────────────────────────────────────────────────
export type AgentId =
  | 'conductor'
  | 'researcher'
  | 'archivist'
  | 'operator'
  | 'planner'
  | 'writer'
  | 'analyst';

export interface AgentMeta {
  id: AgentId;
  name: string;
  /** 한 줄 역할 */
  role: string;
  /** lucide-react 아이콘 이름 */
  icon: string;
  /** CSS 변수 이름 — globals.css 의 --agent-* 토큰 */
  colorVar: string;
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  conductor: { id: 'conductor', name: '지휘자', role: '목표를 나누고 결과를 합칩니다', icon: 'Sparkles', colorVar: '--agent-conductor' },
  researcher: { id: 'researcher', name: '리서처', role: '웹에서 근거를 찾습니다', icon: 'Globe', colorVar: '--agent-researcher' },
  archivist: { id: 'archivist', name: '아키비스트', role: '내 파일을 찾고 읽고 정리합니다', icon: 'FolderOpen', colorVar: '--agent-archivist' },
  operator: { id: 'operator', name: '오퍼레이터', role: '앱과 시스템을 제어합니다', icon: 'SlidersHorizontal', colorVar: '--agent-operator' },
  planner: { id: 'planner', name: '플래너', role: '할 일과 일정을 관리합니다', icon: 'CalendarCheck', colorVar: '--agent-planner' },
  writer: { id: 'writer', name: '라이터', role: '문서와 발표 자료를 만듭니다', icon: 'PenLine', colorVar: '--agent-writer' },
  analyst: { id: 'analyst', name: '애널리스트', role: '샌드박스에서 계산하고 분석합니다', icon: 'ChartLine', colorVar: '--agent-analyst' },
};

// ─── 위험 등급 / 권한 ────────────────────────────────────────
export type ToolRisk = 'safe' | 'confirm' | 'danger';
/** 사용자 지정 정책. 'allow'는 danger 도구에 적용할 수 없다 (서버가 ask로 강등). */
export type ToolPolicy = 'default' | 'allow' | 'ask' | 'block';

export interface ToolInfo {
  name: string;
  description: string;
  risk: ToolRisk;
  group: 'system' | 'apps' | 'files' | 'data' | 'planner' | 'docs' | 'memory' | 'web';
  /** 이 도구를 쓸 수 있는 에이전트 */
  agents: AgentId[];
  /** 이 OS에서 실제로 동작하는가 */
  available: boolean;
  policy: ToolPolicy;
}

// ─── 미션 ────────────────────────────────────────────────────
export type MissionStatus =
  | 'planning'
  | 'awaiting_plan'
  | 'running'
  | 'awaiting_approval'
  | 'synthesizing'
  | 'done'
  | 'failed'
  | 'cancelled';

export const TERMINAL_STATUSES: readonly MissionStatus[] = ['done', 'failed', 'cancelled'];

export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface PlanStep {
  id: string;
  agent: Exclude<AgentId, 'conductor'>;
  /** 사용자에게 보이는 짧은 제목 (예: "경쟁사 가격 조사") */
  title: string;
  /** 에이전트에게 주는 구체적 지시 */
  task: string;
  dependsOn: string[];
}

export interface MissionPlan {
  /** 사용자에게 보이는 미션 제목 */
  title: string;
  /** 'answer': 지휘자가 바로 답함, 'team': 단계 실행 */
  route: 'answer' | 'team';
  steps: PlanStep[];
  rationale?: string;
  /** 계획을 끝내 세우지 못해 도구 없는 답변으로 물러났다 */
  degraded?: boolean;
}

export type ToolCallStatus = 'running' | 'ok' | 'error' | 'denied' | 'blocked';

export interface ToolCallView {
  callId: string;
  stepId: string;
  agent: AgentId;
  name: string;
  summary: string;
  input: unknown;
  risk: ToolRisk;
  /** 서버 측 도구(web_search 등)이면 true */
  serverSide?: boolean;
  status: ToolCallStatus;
  result?: string;
  /** 되돌릴 수 있으면 감사 기록 id */
  undoId?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ApprovalPreview {
  /** 'diff': before/after 텍스트, 'text': 본문 미리보기 */
  kind: 'diff' | 'text';
  path?: string;
  before?: string;
  after?: string;
  text?: string;
  truncated?: boolean;
}

export interface ApprovalRequest {
  id: string;
  kind: 'tool' | 'plan';
  stepId?: string;
  agent: AgentId;
  callId?: string;
  tool?: string;
  /** 사람이 읽는 작업 요약 */
  summary: string;
  risk: ToolRisk;
  /** 승인이 필요한 이유 (위험 등급, 외부 데이터 오염 등) */
  reason: string;
  preview?: ApprovalPreview;
  /** 외부 데이터를 읽은 뒤 나온 요청이면 true (프롬프트 인젝션 경고 표시) */
  tainted?: boolean;
  requestedAt: number;
}

export type ApprovalDecision = 'approve' | 'deny';

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface MissionArtifact {
  kind: 'note' | 'deck' | 'file' | 'task' | 'event';
  id: string;
  title: string;
  /** 파일 경로 또는 내부 id */
  ref: string;
}

export interface StepView {
  step: PlanStep;
  status: StepStatus;
  /** 요약된 추론 스트림 */
  thinking: string;
  /** 본문 스트림 */
  text: string;
  /** 지금 무엇을 하는지 한 줄 (UI 표시용) */
  activity: string;
  toolCalls: ToolCallView[];
  output?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  usage: UsageTotals;
  /** 외부 데이터를 읽었는가 */
  tainted: boolean;
}

export interface MissionTurn {
  /** 사용자 입력 */
  goal: string;
  at: number;
  answer: string;
}

export interface MissionView {
  id: string;
  goal: string;
  title: string;
  status: MissionStatus;
  mode: 'live' | 'demo';
  plan: MissionPlan | null;
  steps: Record<string, StepView>;
  stepOrder: string[];
  /** 계획 단계 지휘자의 요약 추론 */
  conductorThinking: string;
  /** 합성 중인 최종 답변 */
  answer: string;
  /** 후속 질문까지 포함한 이전 턴 */
  turns: MissionTurn[];
  approvals: ApprovalRequest[];
  artifacts: MissionArtifact[];
  usage: UsageTotals;
  /** 이번 턴의 비용 상한. 후속 지시 때 설정값으로 다시 정해진다. */
  budgetUsd: number;
  /** 이번 턴이 시작될 때의 누적 비용. 이번 턴 비용 = usage.costUsd - (turnStartCostUsd ?? 0) */
  turnStartCostUsd?: number;
  error?: { code: MissionErrorCode; message: string };
  createdAt: number;
  /** 이번 턴이 시작된 시각. 경과 시간은 여기서부터 잰다. */
  turnStartedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  /** 마지막으로 적용한 이벤트 seq */
  seq: number;
}

export type MissionErrorCode =
  | 'no_api_key'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'overloaded'
  | 'budget_exceeded'
  | 'refused'
  | 'network'
  | 'internal';

/** SSE로 전달되는 이벤트. seq는 미션 안에서 단조 증가한다. */
export type MissionEvent = { seq: number; at: number } & MissionEventBody;

export type MissionEventBody =
  | { type: 'mission.created'; id: string; goal: string; mode: 'live' | 'demo'; budgetUsd: number }
  | { type: 'mission.status'; status: MissionStatus }
  | { type: 'mission.followup'; goal: string; budgetUsd: number; mode: 'live' | 'demo' }
  | { type: 'conductor.thinking'; delta: string }
  | { type: 'plan.ready'; plan: MissionPlan }
  | { type: 'step.started'; stepId: string }
  | { type: 'step.thinking'; stepId: string; delta: string }
  | { type: 'step.text'; stepId: string; delta: string }
  /** 다시 시도하거나 거절된 호출의 스트림을 지운다. 끝에서부터 이만큼 잘라낸다. */
  | { type: 'step.rollback'; stepId: string; textChars: number; thinkingChars: number }
  | { type: 'step.activity'; stepId: string; activity: string }
  | { type: 'step.tainted'; stepId: string }
  | { type: 'step.finished'; stepId: string; status: StepStatus; output?: string; error?: string }
  | { type: 'tool.started'; call: ToolCallView }
  | { type: 'tool.finished'; stepId: string; callId: string; status: ToolCallStatus; result: string; undoId?: string }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  | { type: 'approval.resolved'; id: string; decision: ApprovalDecision }
  | { type: 'usage'; stepId?: string; model: string; delta: UsageTotals }
  | { type: 'answer.delta'; delta: string }
  /** 다시 시도하는 호출의 답변 스트림을 지운다. 끝에서부터 이만큼 잘라낸다. */
  | { type: 'answer.rollback'; textChars: number; thinkingChars: number }
  /** 빈 text는 이미 받은 답변을 덮어쓰지 않는다. 지우려면 clear를 준다 (거절된 부분 답변). */
  | { type: 'answer.done'; text: string; clear?: boolean }
  | { type: 'artifact'; artifact: MissionArtifact }
  | { type: 'mission.error'; code: MissionErrorCode; message: string }
  | { type: 'mission.finished'; status: MissionStatus };

export type MissionSummary = Pick<
  MissionView,
  'id' | 'goal' | 'title' | 'status' | 'mode' | 'createdAt' | 'updatedAt' | 'finishedAt'
> & { costUsd: number; pendingApprovals: number; agents: AgentId[] };

// ─── 설정 ────────────────────────────────────────────────────
export type ModelPreset = 'best' | 'balanced' | 'economy';

export const MODEL_PRESETS: Record<ModelPreset, { label: string; hint: string; conductor: string; specialist: string }> = {
  best: { label: '최고 품질', hint: '모두 Claude Opus 5.5', conductor: 'claude-opus-5-5', specialist: 'claude-opus-5-5' },
  balanced: { label: '균형', hint: '지휘자 Opus 5.5, 전문가 Sonnet 5.5', conductor: 'claude-opus-5-5', specialist: 'claude-sonnet-5-5' },
  economy: { label: '절약', hint: '지휘자 Sonnet 5.5, 전문가 Haiku 5.5', conductor: 'claude-sonnet-5-5', specialist: 'claude-haiku-5-5' },
};

export type ThemeSetting = 'system' | 'light' | 'dark';
export type WallpaperId = 'tide' | 'dune' | 'aurora' | 'graphite';

export interface Settings {
  displayName: string;
  theme: ThemeSetting;
  wallpaper: WallpaperId;
  /** 유리 효과를 줄이고 불투명한 표면 사용 */
  reduceTransparency: boolean;
  modelPreset: ModelPreset;
  /** 미션 1회당 비용 상한 (USD) */
  budgetUsd: number;
  /** 계획을 실행 전에 보여주고 승인받기 */
  reviewPlans: boolean;
  /** 답변을 음성으로 읽기 */
  speakAnswers: boolean;
  /** 날씨 위치 */
  weatherCity: string;
  /** 도구별 정책 */
  toolPolicies: Record<string, ToolPolicy>;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  theme: 'system',
  wallpaper: 'tide',
  reduceTransparency: false,
  modelPreset: 'best',
  budgetUsd: 2,
  reviewPlans: false,
  speakAnswers: false,
  weatherCity: 'Seoul',
  toolPolicies: {},
  onboarded: false,
};

/**
 * API 키를 어떻게 보관하는가. 'file'은 OS 저장소를 쓸 수 없어 평문으로 둔 것이고,
 * 'unreadable'은 보호된 키가 있지만 지금 풀 수 없는 것이다.
 */
export type ApiKeyStorage = 'env' | 'dpapi' | 'keychain' | 'secret-service' | 'file' | 'unreadable' | 'none';

export interface Bootstrap {
  brand: typeof BRAND;
  platform: 'darwin' | 'win32' | 'linux';
  /** 키가 없으면 'demo' */
  mode: 'live' | 'demo';
  hasApiKey: boolean;
  /** 키 출처. env이면 UI에서 삭제할 수 없다. */
  apiKeySource: 'env' | 'stored' | 'none';
  /** 표시용 마스킹 키 (예: sk-ant-…a1b2) */
  apiKeyHint: string | null;
  apiKeyStorage: ApiKeyStorage;
  settings: Settings;
  dataDir: string;
  /** Electron 패키징 여부 */
  desktop: boolean;
}

// ─── 플래너 ──────────────────────────────────────────────────
export type TaskPriority = 'high' | 'normal' | 'low';

export interface Task {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  /** YYYY-MM-DD */
  due?: string;
  createdAt: number;
  completedAt?: number;
  /** 미션이 만든 항목이면 미션 id */
  missionId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm (없으면 종일) */
  time?: string;
  durationMin?: number;
  kind: 'work' | 'meeting' | 'personal';
  done: boolean;
  createdAt: number;
  missionId?: string;
}

export interface Note {
  /** 빠른 메모 본문 */
  body: string;
  updatedAt: number;
}

export interface MemoryItem {
  id: string;
  text: string;
  /** 'user': 직접 입력, 'agent': 에이전트가 승인 후 저장 */
  source: 'user' | 'agent';
  createdAt: number;
}

export interface Routine {
  id: string;
  title: string;
  goal: string;
  /** lucide 아이콘 이름 */
  icon: string;
  createdAt: number;
  lastRunAt?: number;
}

// ─── 발표 자료 ────────────────────────────────────────────────
export type DeckSlide =
  | { type: 'title'; title: string; subtitle?: string; note?: string }
  | { type: 'bullets'; title: string; bullets: string[]; note?: string }
  | { type: 'stats'; title: string; stats: { label: string; value: string; detail?: string }[]; note?: string }
  | { type: 'bars'; title: string; bars: { label: string; value: number; target?: number; unit?: string }[]; note?: string }
  | { type: 'timeline'; title: string; items: { when: string; what: string }[]; note?: string }
  | { type: 'quote'; quote: string; source?: string; note?: string }
  | { type: 'closing'; title: string; subtitle?: string; note?: string };

export interface Deck {
  id: string;
  title: string;
  slides: DeckSlide[];
  createdAt: number;
  updatedAt: number;
  missionId?: string;
  /** 앱이 기본 제공하는 예시 자료 */
  sample?: boolean;
}

// ─── 감사 기록 ────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  at: number;
  missionId?: string;
  agent?: AgentId;
  tool: string;
  summary: string;
  risk: ToolRisk;
  status: 'ok' | 'error' | 'denied' | 'blocked';
  /** 승인 방식 */
  approvedBy: 'auto' | 'user' | 'policy';
  tainted?: boolean;
  /** 결과 일부 */
  result?: string;
  undoable: boolean;
  undoneAt?: number;
}

// ─── 시스템 ──────────────────────────────────────────────────
export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPct: number;
  memMb: number;
}

export interface SystemSnapshot {
  at: number;
  cpuPct: number;
  perCore: number[];
  cpuModel: string;
  memPct: number;
  memUsedGb: number;
  memTotalGb: number;
  diskPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  /** POSIX에서만 값 있음. Windows는 null */
  load1m: number | null;
  uptimeSec: number;
  hostname: string;
  platform: string;
  battery: { percent: number; charging: boolean } | null;
  /** 초당 바이트, 측정 불가면 null */
  network: { rxBps: number; txBps: number } | null;
  processes: ProcessInfo[];
}

export interface Weather {
  city: string;
  tempC: number;
  feelsC: number;
  desc: string;
  humidity: number;
  windKmh: number;
  icon: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';
}

// ─── REST 계약 ───────────────────────────────────────────────
/**
 * 모든 JSON 오류 응답 형태: { error: { code: string; message: string } }, 사용자에게 보여줄 수 있는 한국어 message.
 *
 * GET    /api/bootstrap                         → Bootstrap
 * GET    /api/settings                          → Settings
 * PATCH  /api/settings            Partial<Settings> → Settings
 * PUT    /api/settings/api-key    { key }       → { ok: true, hint } (Models API로 검증 후 저장, 실패 시 400)
 * DELETE /api/settings/api-key                  → { ok: true }
 * GET    /api/tools                             → { tools: ToolInfo[] }
 * GET    /api/tasks                             → { tasks: Task[] }
 * POST   /api/tasks               { text, priority?, due? } → Task
 * PATCH  /api/tasks/[id]          Partial<Task> → Task
 * DELETE /api/tasks/[id]                        → { ok: true }
 * GET    /api/events?from&to                    → { events: CalendarEvent[] }
 * POST   /api/events              { title, date, time?, durationMin?, kind? } → CalendarEvent
 * PATCH  /api/events/[id]                       → CalendarEvent
 * DELETE /api/events/[id]                       → { ok: true }
 * GET    /api/note                              → Note
 * PUT    /api/note                { body }      → Note
 * GET    /api/memory                            → { items: MemoryItem[] }
 * POST   /api/memory              { text }      → MemoryItem
 * DELETE /api/memory/[id]                       → { ok: true }
 * GET    /api/routines                          → { routines: Routine[] }
 * POST   /api/routines            { title, goal, icon? } → Routine
 * DELETE /api/routines/[id]                     → { ok: true }
 * GET    /api/decks                             → { decks: Deck[] }
 * POST   /api/decks               { title, slides } → Deck
 * GET    /api/decks/[id]                        → Deck
 * DELETE /api/decks/[id]                        → { ok: true }
 * GET    /api/audit?limit&missionId             → { entries: AuditEntry[] }
 * POST   /api/audit/[id]/undo                   → { ok: true, message }
 * GET    /api/system                            → SystemSnapshot
 * GET    /api/weather?city                      → Weather
 * POST   /api/data/import         { todos?, memo?, schedule? } → { ok: true } (구버전 localStorage 이전)
 * GET    /api/data/export                       → 전체 사용자 데이터 JSON (키 제외)
 * DELETE /api/data                              → { ok: true } (저장된 키까지 전부 삭제. 환경 변수 키는 건드리지 못한다)
 *
 * GET    /api/missions                          → { missions: MissionSummary[] }
 * POST   /api/missions            { goal }      → { id } (즉시 반환, 백그라운드 실행)
 * GET    /api/missions/[id]                     → MissionView
 * DELETE /api/missions/[id]                     → { ok: true } (실행 중이면 취소, 끝났으면 삭제)
 * GET    /api/missions/[id]/events?since=seq    → text/event-stream, 각 data는 MissionEvent. Last-Event-ID 지원.
 * POST   /api/missions/[id]/approvals/[apId] { decision: ApprovalDecision, remember?: boolean } → { ok: true }
 * POST   /api/missions/[id]/followup { goal }   → { ok: true } (끝난 미션에 후속 지시)
 */
