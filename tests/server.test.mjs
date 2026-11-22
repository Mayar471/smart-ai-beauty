import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.mjs';

const listen = (s) =>
  new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`)));
const close = (s) => new Promise((resolve) => s.close(resolve));

async function signIn(base, email = 'server@example.test') {
  const response = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'اختبار', email, password: 'test-password-123' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('local server and honest disconnected recommendations', async () => {
  const original = process.env.OLLAMA_MODEL;
  delete process.env.OLLAMA_MODEL;
  const server = createServer({ database: ':memory:' }),
    base = await listen(server);
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /Smart AI Beauty/);
    const js = await fetch(base + '/app.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/api/missing')).status, 404);
    assert.equal((await fetch(base + '/app.js', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
    assert.equal(
      (await fetch(base + '/api/status').then((r) => r.json())).fullOutfitGeneration,
      'disconnected',
    );

    // Suggestions spend the AI quota, so they require an account.
    const anonymous = await fetch(base + '/api/suggestions', { method: 'POST', body: '{}' });
    assert.equal(anonymous.status, 401);
    const cookie = await signIn(base);
    const post = (body) =>
      fetch(base + '/api/suggestions', { method: 'POST', body, headers: { Cookie: cookie } });
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('{}')).status, 400);
    assert.equal((await post('x'.repeat(9000))).status, 413);
    const result = await post(JSON.stringify({ occasion: 'سهرة', preference: 'بسيط' }));
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /غير موصولة/);
  } finally {
    await close(server);
    if (original === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = original;
  }
});

test('static files are revalidated with ETags and compressed for browsers that accept gzip', async () => {
  const server = createServer({ database: ':memory:' }),
    base = await listen(server);
  try {
    const first = await fetch(base + '/app.js', { headers: { 'Accept-Encoding': 'identity' } });
    const etag = first.headers.get('etag');
    assert.ok(etag);
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    assert.equal(first.headers.get('content-encoding'), null);
    const plain = await first.text();
    const cached = await fetch(base + '/app.js', { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);
    const zipped = await fetch(base + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(zipped.headers.get('content-encoding'), 'gzip');
    assert.equal(await zipped.text(), plain);
    const vendor = await fetch(base + '/vendor/mediapipe/manifest.json', { method: 'HEAD' });
    assert.match(vendor.headers.get('cache-control'), /max-age=604800/);
    // Private API responses are never cached.
    assert.equal((await fetch(base + '/api/me')).headers.get('cache-control'), 'no-store');
  } finally {
    await close(server);
  }
});

test('Gemma adapter sends preferences and returns upstream text; errors remain explicit', async () => {
  const oldModel = process.env.OLLAMA_MODEL,
    oldUrl = process.env.OLLAMA_URL;
  let payload,
    fail = false;
  const mock = http.createServer(async (req, res) => {
    let body = '';
    for await (const p of req) body += p;
    payload = JSON.parse(body);
    assert.equal(req.url, '/api/chat');
    res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: 'اقتراح تجريبي من خادم الاختبار' } }));
  });
  process.env.OLLAMA_URL = await listen(mock);
  process.env.OLLAMA_MODEL = 'test-gemma3';
  const server = createServer({ database: ':memory:' }),
    base = await listen(server);
  try {
    const cookie = await signIn(base);
    const run = () =>
      fetch(base + '/api/suggestions', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ occasion: 'سهرة', preference: 'بسيط' }),
      });
    let result = await run();
    assert.equal(result.status, 200);
    assert.match((await result.json()).text, /خادم الاختبار/);
    assert.equal(payload.model, 'test-gemma3');
    assert.equal(payload.stream, false);
    assert.equal(JSON.stringify(payload).includes('images'), false);
    fail = true;
    result = await run();
    assert.equal(result.status, 503);
  } finally {
    await close(server);
    await close(mock);
    if (oldModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = oldModel;
    if (oldUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = oldUrl;
  }
});
