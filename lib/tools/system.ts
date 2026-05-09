import { osa, run, ok, fail } from './exec';
import { register } from './registry';

// ─── 볼륨 ────────────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_volume',
  description: '현재 시스템 볼륨(0-100)을 조회합니다.',
  risk: 'safe',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '시스템 볼륨 조회',
  async run() {
    const out = await osa('output volume of (get volume settings)');
    return `현재 볼륨: ${out}%`;
  },
});

register<{ level: number }>({
  name: 'set_volume',
  description: '시스템 볼륨을 0-100 사이 값으로 설정합니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { level: { type: 'integer', minimum: 0, maximum: 100 } },
    required: ['level'],
    additionalProperties: false,
  },
  summarize: ({ level }) => `시스템 볼륨을 ${level}%로 설정`,
  async run({ level }) {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await osa(`set volume output volume ${clamped}`);
    return ok(`볼륨을 ${clamped}%로 설정했습니다`);
  },
});

// ─── 다크모드 ────────────────────────────────────────────────
register<Record<string, never>>({
  name: 'get_dark_mode',
  description: '현재 다크모드 상태를 조회합니다.',
  risk: 'safe',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '다크모드 상태 조회',
  async run() {
    const out = await osa('tell application "System Events" to tell appearance preferences to get dark mode');
    return `다크모드: ${out === 'true' ? '켜짐' : '꺼짐'}`;
  },
});

register<{ enabled: boolean }>({
  name: 'set_dark_mode',
  description: '시스템 다크모드를 켜거나 끕니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
    additionalProperties: false,
  },
  summarize: ({ enabled }) => `다크모드 ${enabled ? '켜기' : '끄기'}`,
  async run({ enabled }) {
    await osa(
      `tell application "System Events" to tell appearance preferences to set dark mode to ${enabled ? 'true' : 'false'}`
    );
    return ok(`다크모드를 ${enabled ? '켰습니다' : '껐습니다'}`);
  },
});

// ─── 화면 잠금/절전 ──────────────────────────────────────────
register<Record<string, never>>({
  name: 'lock_screen',
  description: '화면을 즉시 잠급니다.',
  risk: 'confirm',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '화면 잠금',
  async run() {
    await run('/usr/bin/pmset', ['displaysleepnow']);
    return ok('화면을 잠갔습니다');
  },
});

register<Record<string, never>>({
  name: 'sleep_system',
  description: 'macOS를 슬립 모드로 전환합니다.',
  risk: 'danger',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '시스템 절전 모드 진입',
  async run() {
    await run('/usr/bin/pmset', ['sleepnow']);
    return ok('절전 모드로 진입합니다');
  },
});

// ─── 알림 / 음성 ─────────────────────────────────────────────
register<{ title: string; body?: string; sound?: string }>({
  name: 'send_notification',
  description: 'macOS 알림 센터에 알림을 표시합니다.',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 80 },
      body: { type: 'string', maxLength: 200 },
      sound: { type: 'string', description: '예: Ping, Glass, Submarine' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  summarize: ({ title }) => `알림: ${title}`,
  async run({ title, body, sound }) {
    const parts = [`display notification "$$"`];
    const args: string[] = [body ?? ''];
    parts.push(`with title "$$"`);
    args.push(title);
    if (sound) {
      parts.push(`sound name "$$"`);
      args.push(sound);
    }
    await osa(parts.join(' '), ...args);
    return ok(`알림을 표시했습니다: ${title}`);
  },
});

register<{ text: string; voice?: string }>({
  name: 'say_text',
  description: '텍스트를 음성으로 출력합니다 (macOS 내장 TTS).',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string', maxLength: 400 },
      voice: { type: 'string', description: '예: Yuna (한국어), Samantha (영어). 생략 시 시스템 기본.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  summarize: ({ text }) => `음성 출력: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`,
  async run({ text, voice }) {
    const args = ['-r', '180'];
    if (voice) args.push('-v', voice);
    args.push(text);
    await run('/usr/bin/say', args, { timeoutMs: 30000 });
    return ok('음성 출력 완료');
  },
});
