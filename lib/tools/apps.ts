import { getPlatform } from '@/lib/platform';
import { webUrl } from '@/lib/platform/url';
import { register } from './registry';

const has = (capability: Parameters<ReturnType<typeof getPlatform>['has']>[0]) => () =>
  getPlatform().has(capability);

/** 앱 이름만 받는다. 경로, 와일드카드, 옵션으로 해석될 수 있는 값은 거부한다. */
export function assertAppName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith('-') || /[\\/:*?"<>|[\]\u0000-\u001f]/.test(trimmed)) {
    throw new Error(`앱 이름으로 쓸 수 없는 값입니다: ${name}`);
  }
  return trimmed;
}

const APP_NAME_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
  required: ['name'],
  additionalProperties: false,
};

register<Record<string, never>>({
  name: 'list_running_apps',
  description: '현재 창을 띄우고 실행 중인 응용 프로그램의 이름을 나열합니다.',
  risk: 'safe',
  group: 'apps',
  agents: ['operator'],
  available: has('listApps'),
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '실행 중인 앱 목록 조회',
  async run() {
    const apps = await getPlatform().listApps();
    return `실행 중인 앱 (${apps.length}개): ${apps.join(', ')}`;
  },
});

register<{ name: string }>({
  name: 'open_app',
  description:
    '설치된 응용 프로그램을 실행합니다. 경로가 아닌 앱 이름을 넘기세요 (예: "Safari", "메모장", "Visual Studio Code"). 시작 메뉴나 응용 프로그램 목록에 없는 프로그램과 스크립트는 실행할 수 없습니다.',
  risk: 'confirm',
  group: 'apps',
  agents: ['operator'],
  available: has('openApp'),
  schema: APP_NAME_SCHEMA,
  summarize: ({ name }) => `${name} 실행`,
  async run({ name }) {
    await getPlatform().openApp(assertAppName(name));
    return `${name}을(를) 실행했습니다`;
  },
});

register<{ name: string }>({
  name: 'focus_app',
  description: '이미 실행 중인 앱을 맨 앞으로 가져옵니다.',
  risk: 'confirm',
  group: 'apps',
  agents: ['operator'],
  available: has('focusApp'),
  schema: APP_NAME_SCHEMA,
  summarize: ({ name }) => `${name}을(를) 맨 앞으로`,
  async run({ name }) {
    await getPlatform().focusApp(assertAppName(name));
    return `${name}을(를) 맨 앞으로 가져왔습니다`;
  },
});

register<{ name: string }>({
  name: 'quit_app',
  description: '응용 프로그램의 창을 닫아 종료합니다. 저장하지 않은 작업이 있으면 앱이 직접 묻습니다.',
  risk: 'danger',
  group: 'apps',
  agents: ['operator'],
  available: has('quitApp'),
  schema: APP_NAME_SCHEMA,
  summarize: ({ name }) => `${name} 종료`,
  async run({ name }) {
    await getPlatform().quitApp(assertAppName(name));
    return `${name}에 종료를 요청했습니다`;
  },
});

register<{ url: string }>({
  name: 'open_url',
  description: '기본 브라우저로 URL을 엽니다. http와 https만 허용합니다.',
  risk: 'confirm',
  group: 'apps',
  agents: ['operator'],
  available: has('openUrl'),
  egress: true,
  schema: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri', maxLength: 2000 } },
    required: ['url'],
    additionalProperties: false,
  },
  summarize: ({ url }) => {
    // 승인 카드에는 실제로 열릴 주소를 보여준다.
    try {
      return `브라우저에서 열기: ${webUrl(url)}`;
    } catch {
      return `브라우저에서 열기 (허용되지 않는 주소): ${url}`;
    }
  },
  async run({ url }) {
    const href = webUrl(url);
    await getPlatform().openUrl(href);
    return `${href}을(를) 열었습니다`;
  },
});
