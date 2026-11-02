import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { DeckSlide } from '@/lib/contracts';
import { addDeck } from '@/lib/store/decks';
import { writeWithJournal } from './files';
import { desktopDir, safeWritePath } from './paths';
import { register } from './registry';

function noteFile(name: string): string {
  const safeName = name.replace(/[^\w\-가-힣 ]/g, '_').trim() || `note-${Date.now()}`;
  return safeWritePath(join(desktopDir(), 'illionaire-notes', `${safeName}.md`));
}

register<{ name: string; content: string }>({
  name: 'save_note',
  description: '바탕 화면의 illionaire-notes 폴더에 마크다운 문서를 저장합니다. 확장자 없는 파일명만 지정하세요.',
  risk: 'confirm',
  group: 'docs',
  agents: ['writer'],
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80, description: '확장자 없는 파일명 (예: meeting-notes)' },
      content: { type: 'string' },
    },
    required: ['name', 'content'],
    additionalProperties: false,
  },
  // 파일명은 안전한 문자로 바뀌므로 실제로 저장될 경로를 보여준다.
  summarize: ({ name, content }) => `문서 저장: ${noteFile(name)} (${content.length}자)`,
  async preview({ name, content }) {
    return {
      kind: 'text',
      path: noteFile(name),
      text: content.slice(0, 8192),
      truncated: content.length > 8192,
    };
  },
  async run({ name, content }, ctx) {
    const file = noteFile(name);
    const outcome = await writeWithJournal(
      file,
      async () => {
        await fs.mkdir(join(desktopDir(), 'illionaire-notes'), { recursive: true });
        await fs.writeFile(file, content, 'utf8');
      },
      `문서를 저장했습니다: ${file}`
    );
    ctx.emitArtifact?.({ kind: 'note', id: file, title: `${name}.md`, ref: file });
    return outcome;
  },
});

register<{ title: string; slides: DeckSlide[] }>({
  name: 'create_deck',
  description:
    '발표 자료를 만듭니다. 슬라이드 종류와 필드: title(title, subtitle), bullets(title, bullets), stats(title, stats[label, value, detail]), bars(title, bars[label, value, target, unit]), timeline(title, items[when, what]), quote(quote, source), closing(title, subtitle). 모든 슬라이드에 note(발표자 노트)를 넣을 수 있습니다. 근거 없는 수치를 지어내지 마세요.',
  risk: 'safe',
  group: 'docs',
  agents: ['writer'],
  sideEffect: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      slides: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['title', 'bullets', 'stats', 'bars', 'timeline', 'quote', 'closing'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            note: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            stats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  detail: { type: 'string' },
                },
                required: ['label', 'value'],
                additionalProperties: false,
              },
            },
            bars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'number' },
                  target: { type: 'number' },
                  unit: { type: 'string' },
                },
                required: ['label', 'value'],
                additionalProperties: false,
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { when: { type: 'string' }, what: { type: 'string' } },
                required: ['when', 'what'],
                additionalProperties: false,
              },
            },
            quote: { type: 'string' },
            source: { type: 'string' },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'slides'],
    additionalProperties: false,
  },
  summarize: ({ title, slides }) => `발표 자료 만들기: ${title} (${slides.length}장)`,
  async preview({ slides }) {
    const lines = slides.map((slide, i) => `${i + 1}. ${'title' in slide ? slide.title : slide.quote}`);
    return { kind: 'text', text: lines.join('\n') };
  },
  async run({ title, slides }, ctx) {
    const deck = await addDeck({ title, slides, missionId: ctx.missionId });
    ctx.emitArtifact?.({ kind: 'deck', id: deck.id, title: deck.title, ref: deck.id });
    return `발표 자료를 만들었습니다: ${deck.title} (${deck.slides.length}장, id ${deck.id})`;
  },
});
