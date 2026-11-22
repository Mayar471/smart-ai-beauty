import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeather, searchLocations, eventDate, coordinates } from '../adapters/weather.mjs';
test('weather is tied to selected date; unavailable or distant forecasts are explicit', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return {
      ok: true,
      json: async () => ({
        timezone: 'Asia/Damascus',
        daily: {
          time: ['2026-10-17', '2026-10-18'],
          temperature_2m_min: [10, 12],
          temperature_2m_max: [22, 24],
          precipitation_probability_max: [0, 70],
          weather_code: [0, 61],
          wind_speed_10m_max: [8, 20],
        },
      }),
    };
  };
  const location = { latitude: 33.5, longitude: 36.3 };
  const w = await getWeather(location, '2026-10-18', { fetchImpl });
  assert.equal(w.min, 12);
  assert.equal(w.rainProbability, 70);
  assert.equal(seen.hostname, 'api.open-meteo.com');
  assert.equal(seen.searchParams.get('timezone'), 'auto');
  const distant = await getWeather(location, '2026-12-01', { fetchImpl });
  assert.equal(distant.status, 'outside-range');
  assert.equal(distant.min, undefined);
  const failed = await getWeather(location, '2026-10-18', {
    fetchImpl: async () => {
      throw Error();
    },
  });
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.max, undefined);
  assert.throws(() => eventDate('2026-02-31'));
  assert.throws(() => coordinates(100, 0));
  assert.throws(() => coordinates('', 0));
});
test('geocoding returns explicit city candidates and handles upstream failure', async () => {
  const result = await searchLocations('دمشق', {
    fetchImpl: async (url) => {
      assert.equal(url.hostname, 'geocoding-api.open-meteo.com');
      assert.equal(url.searchParams.get('name'), 'دمشق');
      return {
        ok: true,
        json: async () => ({
          results: [{ id: 1, name: 'دمشق', country: 'سوريا', latitude: 33.5, longitude: 36.3 }],
        }),
      };
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].latitude, 33.5);
  await assert.rejects(searchLocations('a'), (e) => e.status === 400);
  await assert.rejects(
    searchLocations('Damascus', { fetchImpl: async () => ({ ok: false }) }),
    (e) => e.status === 503,
  );
});
