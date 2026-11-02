'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudLightning, CloudOff, CloudRain, CloudSnow, RotateCcw, Sun, type LucideIcon } from 'lucide-react';
import type { Weather } from '@/lib/contracts';
import { api, ClientApiError } from '@/lib/client/api';
import { IconButton, Material, Skeleton } from '@/components/glass';

const ICONS: Record<Weather['icon'], LucideIcon> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

const ICON_COLOR: Record<Weather['icon'], string> = {
  sun: 'var(--label)',
  cloud: 'var(--label-2)',
  rain: 'var(--accent)',
  snow: 'var(--label)',
  storm: 'var(--agent-writer)',
};

const REFRESH_MS = 10 * 60_000;

/** 설정과 API는 영문 도시명을 쓰므로 자주 쓰는 곳은 한글로 보여준다. */
const CITY_NAMES: Record<string, string> = {
  seoul: '서울',
  busan: '부산',
  incheon: '인천',
  daegu: '대구',
  daejeon: '대전',
  gwangju: '광주',
  ulsan: '울산',
  suwon: '수원',
  sejong: '세종',
  jeju: '제주',
  tokyo: '도쿄',
  osaka: '오사카',
  'new york': '뉴욕',
  london: '런던',
  paris: '파리',
};

function cityName(city: string): string {
  return CITY_NAMES[city.trim().toLowerCase()] ?? city;
}

interface Loaded {
  city: string;
  weather: Weather | null;
  error: string | null;
}

export function useWeather(city: string, active: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !city) return;
    const controller = new AbortController();
    const load = () =>
      api
        .get<Weather>(`/api/weather?city=${encodeURIComponent(city)}`, controller.signal)
        .then((weather) => setLoaded({ city, weather, error: null }))
        .catch((err) => {
          if (controller.signal.aborted) return;
          // 이미 받은 날씨가 있으면 잠깐의 실패로 지우지 않는다.
          setLoaded((cur) =>
            cur?.city === city && cur.weather
              ? cur
              : { city, weather: null, error: err instanceof ClientApiError ? err.message : '날씨를 불러오지 못했어요.' }
          );
        });
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [city, active, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  const current = loaded?.city === city ? loaded : null;
  return { weather: current?.weather ?? null, error: current?.error ?? null, loading: !current, retry };
}

export function WeatherCard({ city, active }: { city: string; active: boolean }) {
  const { weather, error, loading, retry } = useWeather(city, active);

  if (error) {
    return (
      <Material as="section" aria-label="날씨" tier="thin" className="flex items-center gap-3 p-4">
        <CloudOff size={24} className="shrink-0 text-label-2" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-callout font-medium text-label">{cityName(city)} 날씨를 불러오지 못했어요</p>
          <p className="text-footnote text-label-2">인터넷 연결이나 도시 이름을 확인해 주세요.</p>
        </div>
        <IconButton icon={RotateCcw} size="sm" label="날씨 다시 불러오기" onClick={retry} />
      </Material>
    );
  }

  if (loading || !weather) {
    return (
      <Material as="section" aria-label="날씨" aria-busy="true" tier="thin" className="flex items-center gap-3.5 p-4">
        <Skeleton width={40} height={40} radius={999} />
        <div className="flex-1 space-y-2">
          <Skeleton width={84} height={22} radius={6} className="block" />
          <Skeleton width={120} height={12} className="block" />
        </div>
      </Material>
    );
  }

  const Icon = ICONS[weather.icon];
  return (
    <Material as="section" aria-label={`${cityName(weather.city)} 날씨`} tier="thin" className="flex items-center gap-3.5 p-4">
      <Icon size={36} strokeWidth={1.6} className="shrink-0" style={{ color: ICON_COLOR[weather.icon] }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-title1 leading-none text-label tabular-nums">{Math.round(weather.tempC)}°</span>
          <span className="truncate text-callout text-label">{weather.desc}</span>
        </p>
        <p className="mt-1 truncate text-footnote text-label-2">{cityName(weather.city)}</p>
      </div>
      <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-2 gap-y-0.5 text-footnote max-[360px]:hidden">
        <dt className="text-label-2">체감</dt>
        <dd className="text-right text-label tabular-nums">{Math.round(weather.feelsC)}°</dd>
        <dt className="text-label-2">습도</dt>
        <dd className="text-right text-label tabular-nums">{weather.humidity}%</dd>
      </dl>
    </Material>
  );
}
