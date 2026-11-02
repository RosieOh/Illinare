import { getPlatform } from '@/lib/platform';
import { collectSnapshot, getTopProcesses } from '@/lib/platform/stats';
import { headAndTail } from './display';
import { register } from './registry';

const has = (capability: Parameters<ReturnType<typeof getPlatform>['has']>[0]) => () =>
  getPlatform().has(capability);
const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };

// ─── 볼륨 ────────────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_volume',
  description: '현재 시스템 볼륨(0-100)을 조회합니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator'],
  available: has('volume'),
  schema: NO_INPUT,
  summarize: () => '시스템 볼륨 조회',
  async run() {
    return `현재 볼륨: ${await getPlatform().getVolume()}%`;
  },
});

register<{ level: number }>({
  name: 'set_volume',
  description: '시스템 볼륨을 0-100 사이 값으로 설정합니다.',
  risk: 'confirm',
  group: 'system',
  agents: ['operator'],
  available: has('volume'),
  schema: {
    type: 'object',
    properties: { level: { type: 'integer', minimum: 0, maximum: 100 } },
    required: ['level'],
    additionalProperties: false,
  },
  summarize: ({ level }) => `시스템 볼륨을 ${level}%로 설정`,
  async run({ level }) {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await getPlatform().setVolume(clamped);
    return `볼륨을 ${clamped}%로 설정했습니다`;
  },
});

// ─── 다크모드 ────────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_dark_mode',
  description: '현재 다크 모드 상태를 조회합니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator'],
  available: has('darkMode'),
  schema: NO_INPUT,
  summarize: () => '다크 모드 상태 조회',
  async run() {
    return `다크 모드: ${(await getPlatform().getDarkMode()) ? '켜짐' : '꺼짐'}`;
  },
});

register<{ enabled: boolean }>({
  name: 'set_dark_mode',
  description: '시스템 다크 모드를 켜거나 끕니다.',
  risk: 'confirm',
  group: 'system',
  agents: ['operator'],
  available: has('darkMode'),
  schema: {
    type: 'object',
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
    additionalProperties: false,
  },
  summarize: ({ enabled }) => `다크 모드 ${enabled ? '켜기' : '끄기'}`,
  async run({ enabled }) {
    await getPlatform().setDarkMode(enabled);
    return `다크 모드를 ${enabled ? '켰습니다' : '껐습니다'}`;
  },
});

// ─── 화면 잠금/절전 ──────────────────────────────────────────
register<Record<string, never>>({
  name: 'lock_screen',
  description: '화면을 즉시 잠급니다.',
  risk: 'confirm',
  group: 'system',
  agents: ['operator'],
  available: has('lock'),
  schema: NO_INPUT,
  summarize: () => '화면 잠금',
  async run() {
    await getPlatform().lockScreen();
    return '화면을 잠갔습니다';
  },
});

register<Record<string, never>>({
  name: 'sleep_system',
  description: '컴퓨터를 절전 모드로 전환합니다. 진행 중인 작업이 멈춥니다.',
  risk: 'danger',
  group: 'system',
  agents: ['operator'],
  available: has('sleep'),
  schema: NO_INPUT,
  summarize: () => '컴퓨터를 절전 모드로 전환',
  async run() {
    await getPlatform().sleep();
    return '절전 모드로 전환합니다';
  },
});

// ─── 알림 / 음성 ─────────────────────────────────────────────
register<{ title: string; body?: string; sound?: string }>({
  name: 'send_notification',
  description: '운영체제 알림 센터에 알림을 표시합니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator'],
  available: has('notify'),
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 80 },
      body: { type: 'string', maxLength: 200 },
      sound: { type: 'string', maxLength: 40, description: 'macOS 전용. 예: Ping, Glass, Submarine' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  summarize: ({ title, body }) => `알림: ${title}${body ? ` / ${body}` : ''}`,
  recordSummary: ({ title, body }) => `알림 표시 (${title.length + (body?.length ?? 0)}자)`,
  async run(input) {
    await getPlatform().notify(input);
    return '알림을 표시했습니다';
  },
});

register<{ text: string; voice?: string }>({
  name: 'say_text',
  description: '텍스트를 운영체제 내장 음성으로 읽습니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator'],
  available: has('say'),
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 400 },
      voice: { type: 'string', maxLength: 60, description: '음성 이름. 생략하면 시스템 기본 음성.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  summarize: ({ text }) => `음성 출력 (${text.length}자): "${headAndTail(text, 40, 40)}"`,
  recordSummary: ({ text }) => `음성 출력 (${text.length}자)`,
  async run(input) {
    await getPlatform().say(input);
    return '음성 출력을 마쳤습니다';
  },
});

// ─── 클립보드 ──────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_clipboard',
  description: '현재 클립보드의 텍스트를 읽습니다. 비밀번호 등 민감한 내용이 있을 수 있어 승인이 필요합니다.',
  risk: 'confirm',
  group: 'data',
  agents: ['operator'],
  available: has('clipboardRead'),
  readsUntrusted: true,
  schema: NO_INPUT,
  summarize: () => '클립보드 읽기',
  async run() {
    const text = await getPlatform().clipboardRead();
    const shown = text.length > 4000 ? `${text.slice(0, 4000)}\n…(잘림)` : text;
    return `클립보드 (${text.length}자):\n${shown}`;
  },
});

register<{ text: string }>({
  name: 'set_clipboard',
  description: '클립보드에 텍스트를 복사합니다.',
  risk: 'confirm',
  group: 'data',
  agents: ['operator'],
  available: has('clipboardWrite'),
  schema: {
    type: 'object',
    // PowerShell 환경 변수 한도 안으로 제한한다.
    properties: { text: { type: 'string', maxLength: 30000 } },
    required: ['text'],
    additionalProperties: false,
  },
  // 붙여넣게 만들려는 명령은 긴 글 끝에 숨기 쉽다. 요약에 앞뒤를 모두 보이고 미리보기로 전문을 보여준다.
  summarize: ({ text }) => `클립보드에 복사 (${text.length}자): "${headAndTail(text)}"`,
  recordSummary: ({ text }) => `클립보드에 복사 (${text.length}자)`,
  async preview({ text }) {
    return { kind: 'text', text, truncated: false };
  },
  async run({ text }) {
    await getPlatform().clipboardWrite(text);
    return `클립보드에 ${text.length}자를 복사했습니다`;
  },
});

// ─── 시스템 통계 ───────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_system_stats',
  description: '실제 시스템 자원(CPU, 메모리, 디스크, 가동 시간)을 조회합니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator', 'analyst'],
  schema: NO_INPUT,
  summarize: () => '시스템 자원 조회',
  async run() {
    const s = await collectSnapshot();
    const days = Math.floor(s.uptimeSec / 86400);
    const hours = Math.floor((s.uptimeSec % 86400) / 3600);
    const mins = Math.floor((s.uptimeSec % 3600) / 60);
    const lines = [
      `운영체제: ${s.platform} (${s.hostname})`,
      `CPU: ${s.cpuPct.toFixed(0)}% (${s.perCore.length}코어, ${s.cpuModel})`,
      `메모리: ${s.memUsedGb.toFixed(1)}GB / ${s.memTotalGb.toFixed(1)}GB (${s.memPct.toFixed(0)}%)`,
      `디스크: ${s.diskUsedGb.toFixed(0)}GB / ${s.diskTotalGb.toFixed(0)}GB (${s.diskPct.toFixed(0)}%)`,
      `가동 시간: ${days}일 ${hours}시간 ${mins}분`,
    ];
    if (s.load1m !== null) lines.push(`1분 평균 부하: ${s.load1m.toFixed(2)}`);
    if (s.battery) lines.push(`배터리: ${s.battery.percent}% (${s.battery.charging ? '전원 연결' : '방전 중'})`);
    return lines.join('\n');
  },
});

register<{ limit?: number }>({
  name: 'list_processes',
  description: 'CPU와 메모리를 많이 쓰는 프로세스를 이름별로 묶어 보여줍니다. CPU는 전체 코어 대비 비율입니다.',
  risk: 'safe',
  group: 'system',
  agents: ['operator'],
  schema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 40 } },
    additionalProperties: false,
  },
  summarize: () => '실행 중인 프로세스 조회',
  async run({ limit }) {
    const processes = await getTopProcesses(limit ?? 15);
    if (processes.length === 0) return '프로세스 정보를 가져오지 못했습니다';
    return processes.map((p) => `${p.name} (pid ${p.pid}): CPU ${p.cpuPct}%, 메모리 ${p.memMb}MB`).join('\n');
  },
});
