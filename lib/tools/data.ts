import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getPlatform } from '@/lib/platform';
import { getSettings } from '@/lib/store/settings';
import { desktopDir } from './paths';
import { register } from './registry';
import { fetchWeather, isPlausibleCity } from './weather';

// ─── 시간 ─────────────────────────────────────────────────
register<{ timezone?: string }>({
  name: 'get_current_time',
  description: '현재 시각과 날짜를 조회합니다. 시간대를 생략하면 이 컴퓨터의 시간대를 씁니다.',
  risk: 'safe',
  group: 'data',
  agents: ['operator', 'planner', 'writer', 'analyst'],
  schema: {
    type: 'object',
    properties: {
      timezone: { type: 'string', maxLength: 60, description: '예: Asia/Seoul, UTC' },
    },
    additionalProperties: false,
  },
  summarize: ({ timezone }) => `현재 시각 조회${timezone ? ` (${timezone})` : ''}`,
  async run({ timezone }) {
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    let formatted: string;
    try {
      formatted = now.toLocaleString('ko-KR', {
        timeZone: tz,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      throw new Error(`알 수 없는 시간대입니다: ${tz}`);
    }
    return `${formatted} (${tz})`;
  },
});

// ─── 날씨 ─────────────────────────────────────────────────
register<{ city?: string }>({
  name: 'get_weather',
  description: '도시의 현재 날씨를 조회합니다 (wttr.in). 도시 이름만 넘기세요. 생략하면 사용자가 설정한 위치를 씁니다.',
  risk: 'safe',
  group: 'data',
  agents: ['researcher'],
  egress: true,
  schema: {
    type: 'object',
    properties: { city: { type: 'string', maxLength: 48, description: '도시 이름 (영문 권장). 숫자와 기호는 쓸 수 없습니다.' } },
    additionalProperties: false,
  },
  summarize: ({ city }) => `날씨 조회: ${city ?? '설정한 위치'}`,
  async run({ city }) {
    const target = city?.trim() || (await getSettings()).weatherCity;
    if (!isPlausibleCity(target)) throw new Error('도시 이름만 입력할 수 있습니다');
    const w = await fetchWeather(target);
    return `${w.city}: ${w.tempC}°C (체감 ${w.feelsC}°C), ${w.desc}, 습도 ${w.humidity}%, 풍속 ${w.windKmh}km/h`;
  },
});

// ─── 스크린샷 ─────────────────────────────────────────────
register<{ filename?: string }>({
  name: 'take_screenshot',
  description: '전체 화면을 캡처해 바탕 화면의 illionaire-screenshots 폴더에 저장합니다.',
  risk: 'confirm',
  group: 'apps',
  agents: ['operator'],
  available: () => getPlatform().has('screenshot'),
  schema: {
    type: 'object',
    properties: { filename: { type: 'string', maxLength: 80, description: '확장자 없는 파일명. 생략하면 시각으로 정합니다.' } },
    additionalProperties: false,
  },
  summarize: ({ filename }) => `화면 캡처${filename ? `: ${filename}` : ''}`,
  async run({ filename }, ctx) {
    const dir = join(desktopDir(), 'illionaire-screenshots');
    await fs.mkdir(dir, { recursive: true });
    const name = (filename ?? `shot-${Date.now()}`).replace(/[^\w\-가-힣 ]/g, '_');
    const file = join(dir, `${name}.png`);
    await getPlatform().screenshot(file);
    ctx.emitArtifact?.({ kind: 'file', id: file, title: `${name}.png`, ref: file });
    return `스크린샷을 저장했습니다: ${file}`;
  },
});
