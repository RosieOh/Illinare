import type { Deck, DeckSlide } from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, newId, readJson, updateJson } from './json';

interface DecksFile {
  decks: Deck[];
  seeded: boolean;
}

const file = () => dataPath('decks.json');
const MAX_SLIDES = 40;

/** 기본 제공 예시. 앱이 실제로 하는 일만 적는다. 지어낸 수치를 넣지 않는다. */
function sampleDeck(): Deck {
  const now = Date.now();
  return {
    id: newId('deck'),
    title: '일리네어 소개 (예시)',
    sample: true,
    createdAt: now,
    updatedAt: now,
    slides: [
      {
        type: 'title',
        title: '일리네어',
        subtitle: '내 컴퓨터에서 일하는 AI 팀',
        note: '이 자료는 발표 화면을 보여주는 예시입니다. 미션으로 새 자료를 만들 수 있습니다.',
      },
      {
        type: 'bullets',
        title: '일하는 방식',
        bullets: [
          '지휘자가 목표를 단계로 나눕니다',
          '전문 에이전트 여섯이 권한을 나눠 맡아 함께 일합니다',
          '시스템을 바꾸는 행동은 승인한 뒤에 실행합니다',
          '파일 변경은 되돌릴 수 있고 모든 실행은 활동 기록에 남습니다',
        ],
      },
      {
        type: 'timeline',
        title: '미션이 진행되는 순서',
        items: [
          { when: '계획', what: '지휘자가 목표를 단계와 담당자로 나눕니다' },
          { when: '실행', what: '에이전트들이 동시에 일하고 진행 상황이 화면에 보입니다' },
          { when: '승인', what: '위험한 작업은 멈추고 먼저 묻습니다' },
          { when: '종합', what: '결과를 하나로 합쳐 전달합니다' },
        ],
      },
      {
        type: 'stats',
        title: '신뢰를 위한 장치',
        stats: [
          { label: '위험 등급', value: '3단계', detail: '안전, 변경, 위험' },
          { label: '데이터 저장 위치', value: '이 기기', detail: '클라우드 계정이 없습니다' },
          { label: '비용 상한', value: '미션별', detail: '설정에서 정합니다' },
        ],
      },
      {
        type: 'closing',
        title: '무엇을 맡길까요?',
        subtitle: '화면 아래 입력창에 목표를 적어 보세요',
      },
    ],
  };
}

async function load(): Promise<DecksFile> {
  const saved = await readJson<DecksFile | null>(file(), null);
  if (saved) return saved;
  return updateJson<DecksFile>(file(), { decks: [], seeded: false }, (current) =>
    current.seeded ? current : { decks: [sampleDeck(), ...current.decks], seeded: true }
  );
}

function fail(index: number, message: string): never {
  throw new ApiError(400, 'invalid_deck', `${index + 1}번 슬라이드: ${message}`);
}

function text(value: unknown, index: number, label: string, max = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(index, `${label}은(는) 1~${max}자 문자열이어야 해요`);
  }
  return value as string;
}

function optionalText(value: unknown, index: number, label: string, max = 2000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, index, label, max);
}

function list<T>(value: unknown, index: number, label: string, max: number, item: (v: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    fail(index, `${label}은(는) 1~${max}개 항목이어야 해요`);
  }
  return (value as unknown[]).map((v) => {
    if (typeof v !== 'object' || v === null) fail(index, `${label} 항목 형식이 올바르지 않아요`);
    return item(v as Record<string, unknown>);
  });
}

function stringList(value: unknown, index: number, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    fail(index, `${label}은(는) 1~${max}개 항목이어야 해요`);
  }
  return (value as unknown[]).map((v) => text(v, index, `${label} 항목`));
}

/** 슬라이드 유니온 검증. 모르는 필드는 버리고 알려진 필드만 남긴다. */
export function parseSlides(raw: unknown): DeckSlide[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SLIDES) {
    throw new ApiError(400, 'invalid_deck', `슬라이드는 1~${MAX_SLIDES}장이어야 해요.`);
  }
  return raw.map((slide, i): DeckSlide => {
    if (typeof slide !== 'object' || slide === null) fail(i, '형식이 올바르지 않아요');
    const s = slide as Record<string, unknown>;
    const note = optionalText(s.note, i, '발표자 노트');
    const withNote = <T extends object>(body: T) => (note ? { ...body, note } : body);
    switch (s.type) {
      case 'title':
      case 'closing': {
        const subtitle = optionalText(s.subtitle, i, '부제');
        return withNote({
          type: s.type,
          title: text(s.title, i, '제목'),
          ...(subtitle ? { subtitle } : {}),
        });
      }
      case 'bullets':
        return withNote({
          type: 'bullets' as const,
          title: text(s.title, i, '제목'),
          bullets: stringList(s.bullets, i, '목록', 12),
        });
      case 'stats':
        return withNote({
          type: 'stats' as const,
          title: text(s.title, i, '제목'),
          stats: list(s.stats, i, '수치', 8, (v) => {
            const detail = optionalText(v.detail, i, '수치 설명', 200);
            return {
              label: text(v.label, i, '수치 이름', 80),
              value: text(v.value, i, '수치 값', 40),
              ...(detail ? { detail } : {}),
            };
          }),
        });
      case 'bars':
        return withNote({
          type: 'bars' as const,
          title: text(s.title, i, '제목'),
          bars: list(s.bars, i, '막대', 12, (v) => {
            if (typeof v.value !== 'number' || !Number.isFinite(v.value)) fail(i, '막대 값은 숫자여야 해요');
            const unit = optionalText(v.unit, i, '단위', 12);
            return {
              label: text(v.label, i, '막대 이름', 80),
              value: v.value as number,
              ...(typeof v.target === 'number' && Number.isFinite(v.target) ? { target: v.target } : {}),
              ...(unit ? { unit } : {}),
            };
          }),
        });
      case 'timeline':
        return withNote({
          type: 'timeline' as const,
          title: text(s.title, i, '제목'),
          items: list(s.items, i, '항목', 12, (v) => ({
            when: text(v.when, i, '시점', 60),
            what: text(v.what, i, '내용'),
          })),
        });
      case 'quote': {
        const source = optionalText(s.source, i, '출처', 200);
        return withNote({
          type: 'quote' as const,
          quote: text(s.quote, i, '인용문', 800),
          ...(source ? { source } : {}),
        });
      }
      default:
        fail(i, `알 수 없는 슬라이드 종류예요: ${String(s.type)}`);
    }
  });
}

export async function listDecks(): Promise<Deck[]> {
  return (await load()).decks;
}

export async function getDeck(id: string): Promise<Deck> {
  const deck = (await load()).decks.find((d) => d.id === id);
  if (!deck) throw new ApiError(404, 'not_found', '발표 자료를 찾을 수 없어요.');
  return deck;
}

export async function addDeck(input: { title: unknown; slides: unknown; missionId?: string }): Promise<Deck> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) throw new ApiError(400, 'invalid_deck', '자료 제목은 1~120자여야 해요.');
  const slides = parseSlides(input.slides);
  const now = Date.now();
  const deck: Deck = { id: newId('deck'), title, slides, createdAt: now, updatedAt: now };
  if (input.missionId) deck.missionId = input.missionId;
  await load();
  await updateJson<DecksFile>(file(), { decks: [], seeded: true }, (current) => ({
    ...current,
    decks: [deck, ...current.decks],
  }));
  return deck;
}

export async function removeDeck(id: string): Promise<void> {
  await load();
  let found = false;
  await updateJson<DecksFile>(file(), { decks: [], seeded: true }, (current) => {
    found = current.decks.some((d) => d.id === id);
    return { ...current, decks: current.decks.filter((d) => d.id !== id) };
  });
  if (!found) throw new ApiError(404, 'not_found', '발표 자료를 찾을 수 없어요.');
}
