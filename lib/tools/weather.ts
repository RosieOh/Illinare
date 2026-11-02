import type { Weather } from '@/lib/contracts';

/**
 * wttr.in 날씨 조회 (도구와 /api/weather 공용).
 * 도시 이름은 기기 밖으로 나가는 값이다. 숫자나 기호를 막고 길이를 줄여,
 * 프롬프트 인젝션이 이 입력으로 데이터를 빼내지 못하게 한다.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CITY_RE = /^[\p{L}][\p{L}\p{M} .,'’-]{0,47}$/u;
const MAX_WORDS = 5;

export function isPlausibleCity(city: unknown): city is string {
  if (typeof city !== 'string') return false;
  const trimmed = city.trim();
  return CITY_RE.test(trimmed) && trimmed.split(/\s+/).length <= MAX_WORDS;
}

// wttr.in weatherCode → 단순 카테고리
function pickIcon(code: string): Weather['icon'] {
  const n = Number(code);
  if (n === 113) return 'sun';
  if ([116, 119, 122, 143, 248, 260].includes(n)) return 'cloud';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359].includes(n)) return 'rain';
  if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(n)) {
    return 'snow';
  }
  if ([200, 386, 389, 392, 395].includes(n)) return 'storm';
  return 'cloud';
}

/** wttr.in의 lang_ko는 번역되지 않은 영어가 오는 경우가 많아 날씨 코드로 직접 옮긴다. */
const DESCRIPTIONS: [string, number[]][] = [
  ['맑음', [113]],
  ['구름 조금', [116]],
  ['구름 많음', [119]],
  ['흐림', [122]],
  ['안개', [143, 248, 260]],
  ['약한 비', [176, 263, 266, 293, 296, 353]],
  ['비', [299, 302, 356]],
  ['강한 비', [305, 308, 359]],
  ['어는 비', [185, 281, 284, 311, 314]],
  ['진눈깨비', [182, 317, 320, 350, 362, 365, 374, 377]],
  ['약한 눈', [179, 323, 326, 368]],
  ['눈', [227, 329, 332]],
  ['강한 눈', [230, 335, 338, 371]],
  ['뇌우', [200, 386, 389, 392, 395]],
];

function describe(code: string): string {
  const n = Number(code);
  return DESCRIPTIONS.find(([, codes]) => codes.includes(n))?.[0] ?? '-';
}

const cache = new Map<string, { at: number; value: Weather }>();

export async function fetchWeather(city: string): Promise<Weather> {
  if (!isPlausibleCity(city)) throw new Error('도시 이름이 올바르지 않습니다');
  const key = city.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const res = await fetch(`https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`, {
    headers: { 'User-Agent': 'curl/8.0' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`날씨 서비스 응답 오류 (${res.status})`);
  const data = await res.json();
  const cur = data.current_condition?.[0];
  if (!cur) throw new Error('날씨 데이터를 받지 못했습니다');

  const value: Weather = {
    // nearest_area는 근처 측후소 이름이라 사용자가 고른 도시를 그대로 보여준다.
    city: city.trim(),
    tempC: Number(cur.temp_C),
    feelsC: Number(cur.FeelsLikeC),
    desc: describe(cur.weatherCode),
    humidity: Number(cur.humidity),
    windKmh: Number(cur.windspeedKmph),
    icon: pickIcon(cur.weatherCode),
  };
  if (cache.size > 50) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
