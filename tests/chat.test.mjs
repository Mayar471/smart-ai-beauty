import test from 'node:test';
import assert from 'node:assert/strict';
import { beautyChat, scopeRefusal } from '../adapters/chat.mjs';
import { createServer } from '../server.mjs';
test('chat checks topic before answering and preserves real conversation roles', async () => {
  process.env.GEMINI_API_KEY = 'test-only-key';
  process.env.GEMINI_MODEL = 'test-model';
  let calls = [];
  const mock = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body);
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(
                  calls.length === 1
                    ? { allowed: true }
                    : { inScope: true, reply: 'للمقابلة جرّبي كعكة منخفضة مع فرق جانبي.' },
                ),
              },
            ],
          },
        },
      ],
    });
  };
  const result = await beautyChat(
    {
      message: 'وبالنسبة للشعر؟',
      history: [
        { role: 'user', text: 'عندي مقابلة عمل' },
        { role: 'assistant', text: 'قميص أبيض وبنطال رسمي.' },
      ],
    },
    { fetchImpl: mock },
  );
  assert.match(result.text, /كعكة/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].contents[0].role, 'user');
  assert.equal(calls[1].contents[1].role, 'model');
  assert.match(calls[1].contents[0].parts[0].text, /مقابلة/);
  let gateCalls = 0;
  const blocked = await beautyChat(
    { message: 'اكتب برنامج بايثون' },
    {
      fetchImpl: async () => {
        gateCalls++;
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"allowed":false}' }] } }] });
      },
    },
  );
  assert.equal(blocked.text, scopeRefusal);
  assert.equal(gateCalls, 1);
  await assert.rejects(beautyChat({ message: 'x'.repeat(2001) }), (e) => e.status === 400);
});
test('chat messages are persistent per-account context and never visible to another user', async () => {
  let seen;
  const server = createServer({
    database: ':memory:',
    chatResponder: async (input) => {
      seen = input;
      return { text: 'رد تجميلي', inScope: true };
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
  const login = async (email) => {
    const r = await post('/api/register', { name: 'اختبار', email, password: 'test-chat-12345' });
    return r.headers.get('set-cookie').split(';')[0];
  };
  try {
    assert.equal((await post('/api/chat', { message: 'مرحبا' })).status, 401);
    const a = await login('a@chat.test'),
      b = await login('b@chat.test');
    assert.equal((await post('/api/chat', { message: ' ' }, a)).status, 400);
    assert.equal((await post('/api/chat', { message: 'نسقيلي إطلالة' }, a)).status, 200);
    assert.equal(seen.history.length, 0);
    assert.equal((await post('/api/chat', { message: 'وبالنسبة للشعر؟' }, a)).status, 200);
    assert.equal(seen.history.length, 2);
    const other = await (await fetch(base + '/api/chat', { headers: { Cookie: b } })).json();
    assert.equal(other.messages.length, 0);
    const own = await (await fetch(base + '/api/chat', { headers: { Cookie: a } })).json();
    assert.equal(own.messages.length, 4);
    assert.ok(!JSON.stringify(seen.context).includes('base64'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
