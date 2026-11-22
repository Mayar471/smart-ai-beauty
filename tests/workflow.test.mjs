import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
test('occasions and wardrobe persist privately; recommendation uses stored occasion, weather and allowed wardrobe', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sab-workflow-'));
  const database = path.join(dir, 'workspace.sqlite');
  let seen,
    calls = 0;
  const weatherReader = async (location, date) => {
    calls++;
    assert.equal(location.latitude, 33.5);
    return { status: 'available', source: 'Open-Meteo', date, min: 12, max: 23, rainProbability: 30 };
  };
  const recommender = async (input) => {
    seen = input;
    return {
      text: 'تنسيق للمقابلة',
      recommendations: [{ itemId: input.catalog[0].id, reason: 'قميص للمقابلة' }],
    };
  };
  let server = createServer({ database, weatherReader, recommender }),
    base;
  const listen = () =>
    new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      }),
    );
  const close = () => new Promise((r) => server.close(r));
  await listen();
  const post = (route, body, cookie = '') =>
      fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      }),
    get = (route, cookie = '') => fetch(base + route, { headers: { Cookie: cookie } });
  const credentials = { name: 'اختبار', email: 'workflow@example.test', password: 'Test-workflow-123' };
  try {
    const login = await post('/api/register', credentials),
      cookie = login.headers.get('set-cookie').split(';')[0];
    const other = await post('/api/register', { ...credentials, email: 'other-workflow@example.test' }),
      otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await get('/api/events')).status, 401);
    assert.equal((await get('/api/wardrobe')).status, 401);
    assert.equal(
      (await post('/api/wardrobe', { name: 'bad', category: 'invented', image: pixel }, cookie)).status,
      400,
    );
    const upload = await post(
      '/api/wardrobe',
      { name: 'قميص خاص', category: 'shirt, blouse', color: 'أبيض', occasions: ['مقابلة عمل'], image: pixel },
      cookie,
    );
    assert.equal(upload.status, 201);
    const item = (await upload.json()).item;
    assert.equal((await get(item.image, otherCookie)).status, 404);
    assert.equal((await get(item.image)).status, 401);
    const own = await get(item.image, cookie);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    assert.equal(
      (await (await get('/api/catalog', otherCookie)).json()).items.some((i) => i.id === item.id),
      false,
    );
    assert.equal((await (await get('/api/catalog', cookie)).json()).items[0].id, item.id);
    await post('/api/profile', { style: 'رسمي', favoriteColors: 'أبيض', size: 'M', waistCm: 72 }, cookie);
    const input = {
      type: 'مقابلة عمل',
      date: '2026-10-18',
      location: { name: 'دمشق', latitude: 33.5, longitude: 36.3 },
      setting: 'indoor',
      source: 'wardrobe',
      style: 'كلاسيكي',
      preference: 'راحة',
    };
    assert.equal((await post('/api/events', { ...input, date: '2026-02-31' }, cookie)).status, 400);
    const created = await post('/api/events', input, cookie);
    assert.equal(created.status, 201);
    const event = (await created.json()).event;
    assert.equal((await get('/api/events/' + event.id, otherCookie)).status, 404);
    assert.equal((await post('/api/events/' + event.id + '/recommend', {}, otherCookie)).status, 404);
    const recommended = await post(
      '/api/events/' + event.id + '/recommend',
      { weather: { min: 100 }, source: 'catalog' },
      cookie,
    );
    assert.equal(recommended.status, 200);
    assert.equal(seen.weather.min, 12);
    assert.equal(seen.event.location, 'دمشق');
    assert.equal(seen.profile.waistCm, 72);
    assert.equal(seen.profile.style, 'كلاسيكي');
    assert.deepEqual(
      seen.catalog.map((c) => c.id),
      [item.id],
    );
    assert.ok(!JSON.stringify(seen).includes('base64'));
    assert.ok(calls >= 2);
    const look = {
      itemIds: [item.id],
      hair: 'waves',
      color: 'كستنائي',
      makeup: 'warm',
      strength: 'متوسط',
      lip: '#aa6677',
      eye: '#bbaa99',
      blush: '#ddbbcc',
    };
    assert.equal(
      (await post('/api/events/' + event.id + '/look', { ...look, itemIds: ['not-owned'] }, cookie)).status,
      400,
    );
    assert.equal((await post('/api/events/' + event.id + '/look', look, cookie)).status, 200);
    // The session survives a restart, and the look is stored with the default hijab wrap filled in.
    const sessionCookie = cookie;
    await close();
    server = createServer({ database, weatherReader, recommender });
    await listen();
    const relogin = await post('/api/login', credentials),
      restoredCookie = relogin.headers.get('set-cookie').split(';')[0];
    const restored = (await (await get('/api/events/' + event.id, restoredCookie)).json()).event;
    assert.deepEqual(restored.look, { ...look, hijabWrap: 'classic', hijabColor: 'بيج' });
    assert.equal((await get('/api/events/' + event.id, sessionCookie)).status, 200);
    assert.equal((await (await get('/api/wardrobe', restoredCookie)).json()).items.length, 1);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
