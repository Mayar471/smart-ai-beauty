import { AppError } from './errors.mjs';
export function coordinates(latitude, longitude) {
  const lat = Number(latitude),
    lon = Number(longitude);
  if (
    !['number', 'string'].includes(typeof latitude) ||
    !['number', 'string'].includes(typeof longitude) ||
    String(latitude).trim() === '' ||
    String(longitude).trim() === '' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    throw new AppError(400, 'اختاري موقعاً صالحاً من نتائج البحث.');
  return { latitude: lat, longitude: lon };
}
export function eventDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new AppError(400, 'اختاري تاريخاً صالحاً للمناسبة.');
  return value;
}
export async function searchLocations(query, { fetchImpl = fetch } = {}) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100)
    throw new AppError(400, 'اكتبي حرفين على الأقل لاسم المدينة.');
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query.trim(), count: '6', language: 'ar', format: 'json' });
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error();
    const data = await response.json();
    return (data.results || [])
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      .map((r) => ({
        id: r.id,
        name: [r.name, r.admin1, r.country].filter(Boolean).join('، '),
        latitude: r.latitude,
        longitude: r.longitude,
      }));
  } catch {
    throw new AppError(503, 'تعذر البحث عن المدن الآن. تحققي من الإنترنت وأعيدي المحاولة.');
  }
}
export async function getWeather(location, date, { fetchImpl = fetch } = {}) {
  const coords = coordinates(location.latitude, location.longitude);
  eventDate(date);
  const base = { source: 'Open-Meteo', date, fetchedAt: new Date().toISOString() };
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      ...Object.fromEntries(Object.entries(coords).map(([k, v]) => [k, String(v)])),
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
      timezone: 'auto',
      forecast_days: '16',
    });
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error();
    const data = await response.json(),
      daily = data.daily,
      index = daily?.time?.indexOf(date);
    if (index == null || index < 0)
      return {
        ...base,
        status: 'outside-range',
        message: 'لم يتوفر توقع لهذا التاريخ بعد. أعيدي تحديث الطقس عند اقتراب المناسبة.',
      };
    const min = daily.temperature_2m_min?.[index],
      max = daily.temperature_2m_max?.[index];
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw Error();
    return {
      ...base,
      status: 'available',
      timezone: data.timezone,
      min,
      max,
      rainProbability: daily.precipitation_probability_max?.[index] ?? null,
      wind: daily.wind_speed_10m_max?.[index] ?? null,
      code: daily.weather_code?.[index] ?? null,
    };
  } catch {
    return {
      ...base,
      status: 'unavailable',
      message: 'تعذر جلب الطقس. يمكن حفظ المناسبة وإعادة المحاولة لاحقاً.',
    };
  }
}
