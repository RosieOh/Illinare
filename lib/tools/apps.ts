import { osa, run, ok } from './exec';
import { register } from './registry';

// ─── 실행중 앱 ─────────────────────────────────────────────
register<Record<string, never>>({
  name: 'list_running_apps',
  description: '현재 실행중인 모든 응용프로그램의 이름을 나열합니다.',
  risk: 'safe',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '실행중인 앱 목록 조회',
  async run() {
    const out = await osa(
      'tell application "System Events" to get name of (every process whose background only is false)'
    );
    const apps = out.split(', ').filter(Boolean);
    return `실행중인 앱 (${apps.length}개): ${apps.join(', ')}`;
  },
});

register<{ name: string }>({
  name: 'open_app',
  description: '응용프로그램을 실행합니다. (예: "Safari", "Visual Studio Code", "Music")',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  summarize: ({ name }) => `${name} 실행`,
  async run({ name }) {
    await run('/usr/bin/open', ['-a', name]);
    return ok(`${name}을(를) 실행했습니다`);
  },
});

register<{ name: string }>({
  name: 'focus_app',
  description: '이미 실행중인 앱을 최전면으로 활성화합니다.',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  summarize: ({ name }) => `${name}을(를) 활성화`,
  async run({ name }) {
    await osa(`tell application "$$" to activate`, name);
    return ok(`${name}을(를) 활성화했습니다`);
  },
});

register<{ name: string }>({
  name: 'quit_app',
  description: '응용프로그램을 종료합니다.',
  risk: 'danger',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  summarize: ({ name }) => `${name} 종료`,
  async run({ name }) {
    await osa(`tell application "$$" to quit`, name);
    return ok(`${name}을(를) 종료했습니다`);
  },
});

register<{ url: string }>({
  name: 'open_url',
  description: '기본 브라우저로 URL을 엽니다. (http/https만 허용)',
  risk: 'confirm',
  schema: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri' } },
    required: ['url'],
    additionalProperties: false,
  },
  summarize: ({ url }) => `브라우저에서 열기: ${url}`,
  async run({ url }) {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('http(s) URL만 허용됩니다');
    }
    await run('/usr/bin/open', [url]);
    return ok(`${url}을(를) 열었습니다`);
  },
});

register<{ query: string }>({
  name: 'spotlight_search',
  description: 'Spotlight 인덱스에서 파일/문서를 검색합니다 (mdfind 사용). 최대 20건 반환.',
  risk: 'safe',
  schema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
  summarize: ({ query }) => `Spotlight 검색: "${query}"`,
  async run({ query }) {
    const { stdout } = await run('/usr/bin/mdfind', [query]);
    const lines = stdout.trim().split('\n').slice(0, 20);
    return lines.length ? `검색 결과 (${lines.length}건):\n${lines.join('\n')}` : '검색 결과 없음';
  },
});
