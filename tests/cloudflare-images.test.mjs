import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { validateImageRequest } from '../adapters/images.mjs';
import { hairstyles } from '../public/hairstyles.js';
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
test('all ten hairstyle choices reach the image prompt; makeup intensity changes instructions', () => {
  const input = {
    mode: 'hair',
    consent: true,
    color: 'بني داكن',
    lip: '#ab727c',
    eye: '#ce8895',
    blush: '#e9b8b0',
    images: [pixel],
  };
  assert.equal(hairstyles.length, 10);
  for (const style of hairstyles)
    assert.ok(validateImageRequest({ ...input, hair: style.id }).prompt.includes(style.prompt));
  const outfit = { ...input, mode: 'outfit', hair: 'bob', images: [pixel, pixel, pixel] };
  assert.match(validateImageRequest({ ...outfit, strength: 'ناعم' }).prompt, /very light/);
  assert.match(validateImageRequest({ ...outfit, strength: 'بارز' }).prompt, /bold and defined/);
  assert.throws(
    () => validateImageRequest({ ...input, hair: 'invented' }),
    (e) => e.status === 400,
  );
});
test('image generation requires consent and login; results and history are private', async () => {
  let calls = 0;
  const server = createServer({
    database: ':memory:',
    imageRunner: async () => {
      calls++;
      return Buffer.from(pixel.slice(22), 'base64');
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, input, cookie = '') =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(input),
    });
  const input = {
    mode: 'hair',
    consent: true,
    hair: 'back',
    color: 'بني داكن',
    lip: '#ab727c',
    eye: '#ce8895',
    blush: '#e9b8b0',
    images: [pixel],
  };
  try {
    assert.equal((await post('/api/images', input)).status, 401);
    const register = async (email) => {
      const r = await post('/api/register', { email, name: 'اختبار', password: 'test-password-123' });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie').split(';')[0];
    };
    const first = await register('first@example.test'),
      second = await register('second@example.test');
    assert.equal((await post('/api/images', { ...input, consent: false }, first)).status, 400);
    assert.equal(calls, 0);
    assert.equal(
      (await post('/api/images', { ...input, images: ['https://example.com/private'] }, first)).status,
      400,
    );
    assert.equal(calls, 0);
    const r = await post('/api/images', input, first);
    assert.equal(r.status, 201);
    const image = await r.json();
    assert.equal(calls, 1);
    assert.equal(
      (await fetch(base + image.url, { headers: { Cookie: first } })).headers.get('content-type'),
      'image/png',
    );
    assert.equal((await fetch(base + image.url, { headers: { Cookie: second } })).status, 404);
    assert.equal((await fetch(base + image.url)).status, 401);
    const history = await (await fetch(base + '/api/images', { headers: { Cookie: second } })).json();
    assert.equal(history.images.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
