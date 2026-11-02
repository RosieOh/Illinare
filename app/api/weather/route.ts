import { ApiError, handle } from '@/lib/server/http';
import { getSettings } from '@/lib/store/settings';
import { fetchWeather, isPlausibleCity } from '@/lib/tools/weather';

// 결과는 fetchWeather 안에서 10분간 메모리에 캐시한다.
export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const requested = new URL(request.url).searchParams.get('city');
  const city = requested?.trim() || (await getSettings()).weatherCity;
  if (!isPlausibleCity(city)) {
    throw new ApiError(400, 'invalid_city', '도시 이름을 다시 확인해 주세요. 숫자와 기호는 쓸 수 없어요.');
  }
  try {
    return Response.json(await fetchWeather(city));
  } catch {
    throw new ApiError(502, 'weather_unavailable', '날씨 정보를 가져오지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
});
