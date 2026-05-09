export const dynamic = 'force-dynamic';
export const revalidate = 600; // 10분 캐시

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get('city') ?? 'Seoul';

  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { 'User-Agent': 'curl/8.0' },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600 },
    });
    if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`);
    const data = await res.json();
    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!cur) throw new Error('데이터 없음');

    return Response.json({
      city: area?.areaName?.[0]?.value ?? city,
      tempC: Number(cur.temp_C),
      feelsC: Number(cur.FeelsLikeC),
      desc: cur.lang_ko?.[0]?.value ?? cur.weatherDesc?.[0]?.value ?? '-',
      humidity: Number(cur.humidity),
      windKmh: Number(cur.windspeedKmph),
      icon: pickIcon(cur.weatherCode),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

// wttr.in weatherCode (WMO) → 단순 카테고리
function pickIcon(code: string): 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' {
  const n = Number(code);
  if ([113].includes(n)) return 'sun';
  if ([116, 119, 122, 143, 248, 260].includes(n)) return 'cloud';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359].includes(n))
    return 'rain';
  if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(n))
    return 'snow';
  if ([200, 386, 389, 392, 395].includes(n)) return 'storm';
  return 'cloud';
}
