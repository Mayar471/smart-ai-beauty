import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePose } from '../public/pose-metrics.js';
import { loadCatalog, validateRecommendations } from '../adapters/catalog.mjs';
test('pose observations reject missing data and mark cropped or uncertain limbs incomplete', () => {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  points[0].y = 0.1;
  for (const i of [11, 12]) points[i].y = 0.25;
  for (const i of [23, 24]) points[i].y = 0.5;
  for (const i of [27, 28]) points[i].y = 0.9;
  let result = summarizePose(points, 800, 1200);
  assert.equal(result.fullBodyVisible, true);
  assert.equal(result.pose, 'upright');
  assert.deepEqual(result.upperBodyBand, { top: 0.25, bottom: 0.5 });
  assert.equal('size' in result, false);
  assert.equal('weight' in result, false);
  points[28].y = 1.1;
  result = summarizePose(points, 800, 1200);
  assert.equal(result.fullBodyVisible, false);
  assert.equal(result.pose, 'other');
  points[28].y = 0.9;
  points[27].visibility = 0.2;
  assert.equal(summarizePose(points, 800, 1200).fullBodyVisible, false);
  assert.throws(() => summarizePose([], 800, 1200), /الجسم/);
});
test('catalog contains traced garments and rejects invented and duplicate recommendations', async () => {
  const catalog = await loadCatalog();
  assert.equal(new Set(catalog.map((c) => c.id)).size, catalog.length);
  const photos = catalog.filter((c) => c.id.startsWith('fp-'));
  assert.equal(photos.length, 3);
  assert.ok(photos.every((c) => c.annotationId && c.sourceImageId && c.maskType === 'polygon'));
  assert.equal(
    catalog.filter((c) => c.modest && c.includesHijab && c.source === 'generated-sample').length,
    3,
  );
  const id = catalog[0].id;
  const filtered = validateRecommendations(
    {
      text: 'اقتراح',
      recommendations: [
        { itemId: 'invented', reason: 'unknown' },
        { itemId: id, reason: 'مناسب' },
        { itemId: id, reason: 'مكرر' },
        { itemId: catalog[1].id, reason: '' },
      ],
    },
    catalog,
  );
  assert.deepEqual(filtered.recommendations, [{ itemId: id, reason: 'مناسب' }]);
  assert.throws(() => validateRecommendations({ text: 'test' }, catalog));
});
