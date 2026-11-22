import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, recommend } from '../adapters/suggestions.mjs';
test('Gemini contract excludes photos and secrets from prompt; quota remains explicit', async () => {
  const old = { ...process.env };
  process.env.AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-secret';
  process.env.GEMINI_MODEL = 'test-model';
  let seen;
  try {
    const input = {
      occasion: 'سهرة',
      preference: 'هادئ',
      profile: {
        style: 'بسيط',
        favoriteColors: 'أخضر',
        size: 'M',
        waistCm: 72,
        face: 'private-photo',
        email: 'private-email',
      },
      event: { type: 'سهرة', date: '2026-10-17', location: 'دمشق', setting: 'outdoor' },
      weather: { status: 'available', min: 11, max: 23, rainProbability: 60 },
    };
    const text = await suggest(input, {
      fetchImpl: async (url, options) => {
        seen = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'اقتراح اختبار' }] } }] }),
        };
      },
    });
    assert.equal(text, 'اقتراح اختبار');
    assert.match(seen.url, /test-model:generateContent$/);
    assert.equal(seen.options.headers['x-goog-api-key'], 'test-secret');
    assert.equal(seen.options.body.includes('private-photo'), false);
    assert.equal(seen.options.body.includes('private-email'), false);
    assert.equal(seen.options.body.includes('test-secret'), false);
    assert.match(seen.options.body, /بسيط/);
    const context = JSON.parse(JSON.parse(seen.options.body).contents[0].parts[0].text);
    assert.equal(context.weather.rainProbability, 60);
    assert.equal(context.event.location, 'دمشق');
    assert.equal(context.profile.userProvidedMeasurementsCm.waistCm, 72);
    await assert.rejects(
      suggest(input, { fetchImpl: async () => ({ ok: false, status: 429 }) }),
      /حد الاستخدام/,
    );
    const catalog = [{ id: 'dress-01', name: 'فستان', image: '/assets/dress.png' }];
    const structured = await recommend(
      {
        ...input,
        catalog,
        analysis: { model: 'mediapipe-pose-lite', fullBodyVisible: true, pose: 'upright' },
      },
      {
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          assert.equal(body.generationConfig.responseMimeType, 'application/json');
          assert.deepEqual(
            body.generationConfig.responseJsonSchema.properties.recommendations.items.properties.itemId.enum,
            ['dress-01'],
          );
          assert.match(body.contents[0].parts[0].text, /bodyImageCheck/);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          text: 'اقتراح',
                          recommendations: [
                            { itemId: 'dress-01', reason: 'مناسب' },
                            { itemId: 'invented', reason: 'غير متاح' },
                          ],
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        },
      },
    );
    assert.deepEqual(structured.recommendations, [{ itemId: 'dress-01', reason: 'مناسب' }]);
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(suggest(input), /ينتظر/);
  } finally {
    for (const k of ['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL'])
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
  }
});
