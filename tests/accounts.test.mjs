import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
const listen = (s) =>
  new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`)));
const close = (s) => new Promise((resolve) => s.close(resolve));
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
test('accounts persist both private photos, isolate accounts, reject invalid auth and origins', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sab-test-'));
  const database = path.join(dir, 'accounts.sqlite');
  let server = createServer({ database }),
    base = await listen(server);
  const post = (route, body, cookie = '', origin) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
  const account = { name: 'اختبار', email: 'test@example.test', password: 'test-password-123' };
  try {
    let response = await post('/api/register', account);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    let result = await response.json();
    assert.equal(result.user.name, 'اختبار');
    assert.equal(result.user.password, undefined);
    assert.equal((await post('/api/register', account)).status, 409);
    assert.equal(
      (await post('/api/login', { email: account.email, password: 'wrong-password' })).status,
      401,
    );
    assert.equal((await post('/api/photos', { face: pixel, body: pixel })).status, 401);
    assert.equal(
      (await post('/api/photos', { face: pixel, body: 'data:image/png;base64,bad' }, cookie)).status,
      400,
    );
    assert.equal(
      (await post('/api/photos', { face: pixel, body: pixel }, cookie, 'https://external.example')).status,
      403,
    );
    response = await post('/api/photos', { face: pixel, body: pixel }, cookie);
    assert.equal(response.status, 200);
    result = await response.json();
    assert.equal(result.user.hasFace, true);
    assert.equal(result.user.hasBody, true);
    const revision = result.user.photoRevision;
    const summary = {
      version: 1,
      model: 'mediapipe-pose-lite',
      width: 1,
      height: 1,
      landmarkCount: 33,
      visibleLandmarks: 25,
      fullBodyVisible: true,
      pose: 'upright',
      upperBodyBand: { top: 0.25, bottom: 0.6 },
    };
    assert.equal(
      (await post('/api/analysis', { photoRevision: 'outdated', result: summary }, cookie)).status,
      409,
    );
    assert.equal(
      (await post('/api/analysis', { photoRevision: revision, result: { ...summary, width: 999 } }, cookie))
        .status,
      400,
    );
    for (const band of [
      { top: 0.7, bottom: 0.2 },
      { top: -0.1, bottom: 0.6 },
      { top: 0.4, bottom: 1.2 },
      { top: 'bad', bottom: 0.6 },
    ])
      assert.equal(
        (
          await post(
            '/api/analysis',
            { photoRevision: revision, result: { ...summary, upperBodyBand: band } },
            cookie,
          )
        ).status,
        400,
      );
    response = await post('/api/analysis', { photoRevision: revision, result: summary }, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.analysis.fullBodyVisible, true);
    response = await post('/api/profile', { style: 'بسيط', favoriteColors: 'زيتوني', size: 'M' }, cookie);
    assert.equal(response.status, 200);
    const saved = (await response.json()).user.analysis;
    assert.equal(saved.model, 'mediapipe-pose-lite');
    assert.deepEqual(saved.upperBodyBand, summary.upperBodyBand);
    const own = await fetch(base + '/api/photo/face', { headers: { Cookie: cookie } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await own.arrayBuffer()), Buffer.from(pixel.slice(22), 'base64'));
    assert.equal((await fetch(base + '/api/photo/body')).status, 401);
    assert.equal((await fetch(base + '/runtime/accounts.sqlite')).status, 404);
    response = await post('/api/register', { ...account, email: 'other@example.test' });
    const otherCookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/photo/face', { headers: { Cookie: otherCookie } })).status, 404);
    await post('/api/logout', {}, cookie);
    assert.equal((await fetch(base + '/api/photo/face', { headers: { Cookie: cookie } })).status, 401);
    await close(server);
    server = createServer({ database });
    base = await listen(server);
    response = await post('/api/login', account);
    assert.equal(response.status, 200);
    const restoredCookie = response.headers.get('set-cookie').split(';')[0];
    const restored = await response.json();
    assert.equal(restored.user.hasBody, true);
    assert.equal(restored.user.profile.style, 'بسيط');
    assert.equal(restored.user.analysis.fullBodyVisible, true);
    response = await post('/api/photos', { face: pixel, body: pixel }, restoredCookie);
    assert.deepEqual((await response.json()).user.analysis, {});
    // A database dump must not contain the plaintext password.
    const file = await readFile(database);
    assert.equal(file.includes(Buffer.from(account.password)), false);
  } finally {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  }
});
