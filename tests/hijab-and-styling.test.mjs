import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { validateImageRequest } from '../adapters/images.mjs';
import { recommendationContext } from '../adapters/suggestions.mjs';
import { bodyFeatures, stylingBrief, validateFeatures } from '../public/appearance-features.js';
import { hijabStyles, hijabColors, hairColors, defaultLook } from '../public/options.js';

const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const makeup = { lip: '#ab727c', eye: '#ce8895', blush: '#e9b8b0' };

async function start(options = {}) {
  const server = createServer({ database: ':memory:', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request =
    (method) =>
    (route, body, cookie = '') =>
      fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  const post = request('POST');
  const register = async (email, extra = {}) => {
    const response = await post('/api/register', {
      name: 'اختبار',
      email,
      password: 'test-password-123',
      ...extra,
    });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
  };
  return {
    post,
    get: (route, cookie = '') => fetch(base + route, { headers: { Cookie: cookie } }),
    del: (route, cookie = '') => request('DELETE')(route, undefined, cookie),
    register,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('every hijab wrap and colour reaches the image prompt and never exposes hair', () => {
  assert.equal(hijabStyles.length, 8);
  for (const wrap of hijabStyles)
    for (const mode of ['hair', 'outfit']) {
      const prompt = validateImageRequest({
        mode,
        consent: true,
        hijab: true,
        modest: true,
        hijabWrap: wrap.id,
        hijabColor: 'كحلي',
        images: mode === 'hair' ? [pixel] : [pixel, pixel, pixel],
        ...makeup,
      }).prompt;
      assert.ok(prompt.includes(wrap.prompt));
      assert.match(prompt, /navy blue/);
      assert.match(prompt, /No exposed hair/);
      assert.doesNotMatch(prompt, /hairstyle/);
    }
  const hijabRequest = { mode: 'hair', consent: true, hijab: true, images: [pixel], ...makeup };
  assert.throws(
    () => validateImageRequest({ ...hijabRequest, hijabWrap: 'invented' }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => validateImageRequest({ ...hijabRequest, hijabColor: 'invented' }),
    (e) => e.status === 400,
  );
  // Without the hijab every hair colour is accepted and described to the model.
  for (const color of hairColors)
    assert.ok(
      validateImageRequest({
        mode: 'hair',
        consent: true,
        hair: 'bob',
        color: color.name,
        images: [pixel],
        ...makeup,
      }).prompt.includes(color.prompt),
    );
  assert.ok(hijabColors.some((c) => c.name === defaultLook().hijabColor));
});

test('the styling brief follows manual corrections and adapts its guidance to the hijab', () => {
  const features = validateFeatures({
    version: 1,
    face: { shape: 'round', lengthToWidth: 1.1, jawToCheek: 0.8, foreheadToJaw: 1.1 },
    body: { balance: 'hips', vertical: 'long-torso', shoulderToHip: 0.85, legToTorso: 1.3 },
  });
  const hair = stylingBrief({ hijabStyle: 'none', faceShape: 'auto' }, features);
  assert.equal(hair.faceShape, 'round');
  assert.equal(hair.faceShapeSource, 'image-estimate');
  assert.equal(hair.wearsHijab, false);
  assert.ok(hair.guidance.length >= 4);
  assert.ok(hair.guidance.every((line) => !line.includes('حجاب')));

  const hijab = stylingBrief({ hijabStyle: 'hijab', faceShape: 'elongated', bodyBalance: 'auto' }, features);
  assert.equal(hijab.faceShape, 'elongated');
  assert.equal(hijab.faceShapeSource, 'user-reviewed');
  assert.equal(hijab.bodyBalance, 'hips');
  assert.match(hijab.guidance[0], /لفة/);
  assert.ok(hijab.guidance.some((line) => line.includes('الإطلالة بالحجاب')));

  const empty = stylingBrief({}, null);
  assert.equal(empty.faceShape, 'unknown');
  assert.equal(empty.ratios, null);
  assert.deepEqual(empty.guidance, []);

  // Features saved by older versions lack the newer fields and still validate.
  const legacy = validateFeatures({
    version: 1,
    face: { shape: 'oval', lengthToWidth: 1.3, jawToCheek: 0.7 },
    body: { balance: 'balanced', shoulderToHip: 1 },
  });
  assert.equal(legacy.body.vertical, 'unknown');
  assert.equal(legacy.face.foreheadToJaw, null);
});

test('body proportions come from upright landmarks only', () => {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (index, x, y) => (points[index] = { x, y });
  set(11, 0.38, 0.2);
  set(12, 0.62, 0.2);
  set(23, 0.4, 0.5);
  set(24, 0.6, 0.5);
  set(27, 0.42, 0.95);
  set(28, 0.58, 0.95);
  const upright = { fullBodyVisible: true, pose: 'upright' };
  const result = bodyFeatures(points, 1000, 1000, upright);
  assert.equal(result.balance, 'shoulders');
  assert.equal(result.shoulderToHip, 1.2);
  assert.equal(result.legToTorso, 1.5);
  assert.equal(result.vertical, 'balanced');
  set(27, 0.42, 0.9);
  set(28, 0.58, 0.9);
  assert.equal(bodyFeatures(points, 1000, 1000, upright).vertical, 'long-torso');
  assert.equal(
    bodyFeatures(points, 1000, 1000, { fullBodyVisible: true, pose: 'other' }).vertical,
    'unknown',
  );
});

test('the recommendation context carries the brief as text and no photo data', () => {
  const context = recommendationContext({
    occasion: 'زواج',
    preference: '',
    profile: { hijabStyle: 'hijab', modesty: 'modest', faceShape: 'round', heightCm: 165 },
    analysis: { model: 'mediapipe-pose-lite', fullBodyVisible: true, pose: 'upright', features: null },
    catalog: [{ id: 'a', name: 'عباءة', category: 'dress', modest: true, source: 'wardrobe', image: pixel }],
  });
  assert.equal(context.profile.stylingBrief.wearsHijab, true);
  assert.equal(context.profile.stylingBrief.faceShape, 'round');
  assert.equal(context.profile.userProvidedMeasurementsCm.heightCm, 165);
  assert.equal(context.catalog[0].source, 'personal wardrobe');
  assert.ok(!JSON.stringify(context).includes('base64'));
});

test('hijab onboarding, partial profile updates, hijab looks and clean-up of deleted items', async () => {
  let recommendations = 0;
  const app = await start({
    weatherReader: async (_location, date) => ({ status: 'available', date, min: 10, max: 20 }),
    recommender: async (input) => {
      recommendations++;
      return { text: 'اقتراح', recommendations: [{ itemId: input.catalog[0].id, reason: 'مناسب' }] };
    },
  });
  try {
    const { cookie, user } = await app.register('hijab@example.test', { hijab: true });
    assert.equal(user.profile.hijabStyle, 'hijab');
    assert.equal(user.profile.modesty, 'modest');
    assert.equal(
      (
        await app.post('/api/register', {
          name: 'x',
          email: 'bad@example.test',
          password: 'test-password-123',
          hijab: 'yes',
        })
      ).status,
      400,
    );

    // A partial update must not wipe the fields it does not mention.
    await app.post(
      '/api/profile',
      { style: 'كلاسيكي', favoriteColors: 'زيتي', size: 'M', heightCm: 165 },
      cookie,
    );
    const partial = await (await app.post('/api/profile', { hijabStyle: 'none' }, cookie)).json();
    assert.equal(partial.user.profile.style, 'كلاسيكي');
    assert.equal(partial.user.profile.heightCm, 165);
    assert.equal(partial.user.profile.hijabStyle, 'none');
    await app.post('/api/profile', { hijabStyle: 'hijab' }, cookie);
    const brief = await (await app.get('/api/styling-brief', cookie)).json();
    assert.equal(brief.brief.wearsHijab, true);
    assert.equal((await app.get('/api/styling-brief')).status, 401);

    const item = (
      await (
        await app.post(
          '/api/wardrobe',
          { name: 'عباءة', category: 'dress', color: 'أسود', occasions: [], modest: true, image: pixel },
          cookie,
        )
      ).json()
    ).item;
    assert.equal(item.modest, true);

    const input = {
      type: 'زواج',
      date: '2026-12-01',
      location: { name: 'دمشق', latitude: 33.5, longitude: 36.3 },
      setting: 'indoor',
      source: 'wardrobe',
      style: 'ناعم',
      preference: '',
    };
    const event = (await (await app.post('/api/events', input, cookie)).json()).event;
    const recommended = (await (await app.post(`/api/events/${event.id}/recommend`, {}, cookie)).json())
      .event;
    assert.equal(recommended.recommendations.length, 1);

    // Saving the occasion again without changes keeps the recommendation; changing its context clears it.
    const unchanged = (await (await app.post('/api/events/' + event.id, input, cookie)).json()).event;
    assert.equal(unchanged.recommendations.length, 1);
    assert.equal(unchanged.advice, 'اقتراح');
    const changed = (
      await (await app.post('/api/events/' + event.id, { ...input, type: 'سهرة' }, cookie)).json()
    ).event;
    assert.deepEqual(changed.recommendations, []);
    assert.equal(recommendations, 1);

    const look = { ...defaultLook(), itemIds: [item.id], hijabWrap: 'turkish', hijabColor: 'عنابي' };
    assert.equal(
      (await app.post(`/api/events/${event.id}/look`, { ...look, hijabWrap: 'invented' }, cookie)).status,
      400,
    );
    const saved = (await (await app.post(`/api/events/${event.id}/look`, look, cookie)).json()).event;
    assert.equal(saved.look.hijabWrap, 'turkish');

    // Deleting a garment removes it from saved looks; other accounts cannot delete it.
    const other = await app.register('other-hijab@example.test');
    assert.equal((await app.del('/api/wardrobe/' + item.id, other.cookie)).status, 404);
    assert.equal((await app.del('/api/wardrobe/' + item.id, cookie)).status, 200);
    const cleaned = (await (await app.get('/api/events/' + event.id, cookie)).json()).event;
    assert.deepEqual(cleaned.look.itemIds, []);
    assert.equal(cleaned.look.hijabWrap, 'turkish');

    assert.equal((await app.del('/api/events/' + event.id, other.cookie)).status, 404);
    assert.equal((await app.del('/api/events/' + event.id, cookie)).status, 200);
    assert.equal((await app.get('/api/events/' + event.id, cookie)).status, 404);
  } finally {
    await app.close();
  }
});

test('AI quotas are per account and failed generations are not counted', async () => {
  let fail = true;
  const app = await start({
    limits: { imagesPerHour: 1, chatPerHour: 1, recommendationsPerHour: 1, concurrentImages: 2 },
    imageRunner: async () => {
      if (fail) throw Object.assign(new Error('down'), { status: 503 });
      return Buffer.from(pixel.slice(22), 'base64');
    },
    chatResponder: async () => ({ text: 'رد', inScope: true }),
  });
  try {
    const first = await app.register('quota-a@example.test');
    const second = await app.register('quota-b@example.test');
    const image = { mode: 'hair', consent: true, hair: 'bob', color: 'أسود', images: [pixel], ...makeup };
    assert.equal((await app.post('/api/images', image, first.cookie)).status, 500);
    fail = false;
    assert.equal((await app.post('/api/images', image, first.cookie)).status, 201);
    assert.equal((await app.post('/api/images', image, first.cookie)).status, 429);
    assert.equal((await app.post('/api/images', image, second.cookie)).status, 201);

    assert.equal((await app.post('/api/chat', { message: 'مرحبا' }, first.cookie)).status, 200);
    assert.equal((await app.post('/api/chat', { message: 'مرحبا' }, first.cookie)).status, 429);
    assert.equal((await app.del('/api/chat', first.cookie)).status, 200);
    assert.deepEqual((await (await app.get('/api/chat', first.cookie)).json()).messages, []);
  } finally {
    await app.close();
  }
});
