import test from 'node:test';
import assert from 'node:assert/strict';
import { faceFeatures, bodyFeatures, validateFeatures } from '../public/appearance-features.js';
import { validateImageRequest } from '../adapters/images.mjs';
import { createServer } from '../server.mjs';
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
test('appearance ratios reject angled and incomplete observations; hijab prompt does not expose hair', () => {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  p[234] = { x: 0.2, y: 0.5 };
  p[454] = { x: 0.8, y: 0.5 };
  p[10] = { x: 0.5, y: 0.1 };
  p[152] = { x: 0.5, y: 0.9 };
  p[172] = { x: 0.3, y: 0.8 };
  p[397] = { x: 0.7, y: 0.8 };
  p[33] = { x: 0.35, y: 0.4 };
  p[263] = { x: 0.65, y: 0.4 };
  p[1] = { x: 0.5, y: 0.5 };
  const f = faceFeatures(p, 100, 100);
  assert.equal(f.shape, 'oval');
  p[1].x = 0.8;
  assert.equal(faceFeatures(p, 100, 100).shape, 'unknown');
  assert.equal(bodyFeatures([], 100, 100, { fullBodyVisible: false }).balance, 'unknown');
  assert.throws(() =>
    validateFeatures({
      version: 1,
      face: { shape: 'oval', lengthToWidth: Infinity },
      body: { balance: 'hips' },
    }),
  );
  const prompt = validateImageRequest({
    mode: 'outfit',
    consent: true,
    hair: 'back',
    color: 'بني داكن',
    images: [pixel, pixel, pixel],
    lip: '#aa6677',
    eye: '#aa6677',
    blush: '#aa6677',
    hijab: true,
    modest: true,
  }).prompt;
  assert.match(prompt, /No exposed hair/);
  assert.match(prompt, /long sleeved/);
  assert.doesNotMatch(prompt, /Change the hairstyle visibly/);
});
test('appearance revisions, private storage and reviewed hijab preferences reach generation', async () => {
  let received;
  const server = createServer({
    database: ':memory:',
    imageRunner: async (input) => {
      received = input;
      return Buffer.from(pixel.slice(22), 'base64');
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`,
    post = (p, b, c = '') =>
      fetch(base + p, {
        method: 'POST',
        headers: { Cookie: c, 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      });
  try {
    const auth = await post('/api/register', {
        name: 'اختبار',
        email: 'appearance@example.test',
        password: 'appearance-12345',
      }),
      cookie = auth.headers.get('set-cookie').split(';')[0];
    const saved = await (await post('/api/photos', { face: pixel, body: pixel }, cookie)).json();
    const features = {
      version: 1,
      face: { shape: 'oval', lengthToWidth: 1.3, jawToCheek: 0.7 },
      body: { balance: 'unknown', shoulderToHip: null },
    };
    assert.equal((await post('/api/features', { features, photoRevision: 'old' }, cookie)).status, 409);
    const result = await post('/api/features', { features, photoRevision: saved.user.photoRevision }, cookie);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).user.analysis.features.face.shape, 'oval');
    assert.equal(
      (await post('/api/features', { features, photoRevision: saved.user.photoRevision })).status,
      401,
    );
    const pref = await post(
      '/api/profile',
      { hijabStyle: 'hijab', modesty: 'modest', faceShape: 'round', bodyBalance: 'auto' },
      cookie,
    );
    assert.equal(pref.status, 200);
    assert.equal((await pref.json()).user.profile.faceShape, 'round');
    assert.equal((await post('/api/profile', { hijabStyle: 'invented' }, cookie)).status, 400);
    const gen = await post(
      '/api/images',
      {
        mode: 'outfit',
        consent: true,
        hair: 'back',
        color: 'بني داكن',
        images: [pixel, pixel, pixel],
        lip: '#aa6677',
        eye: '#aa6677',
        blush: '#aa6677',
        hijab: false,
      },
      cookie,
    );
    assert.equal(gen.status, 201);
    assert.equal(received.hijab, true);
    assert.equal(received.modest, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
