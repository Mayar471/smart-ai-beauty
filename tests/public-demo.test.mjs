import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
test('temporary demo accepts only its configured HTTPS origin and sets secure session cookies', async () => {
  const publicOrigin = 'https://example-demo.trycloudflare.com',
    server = createServer({ database: ':memory:', publicOrigin });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (origin) =>
    fetch(base + '/api/register', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'عرض', email: 'demo@example.test', password: 'test-demo-12345' }),
    });
  try {
    assert.equal((await request('https://untrusted.example')).status, 403);
    const r = await request(publicOrigin);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /; Secure/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
