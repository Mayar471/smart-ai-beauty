import { readFile } from 'node:fs/promises';
const file = new URL('../public/catalog.json', import.meta.url);
export async function loadCatalog() {
  const items = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(items)) throw new Error('Invalid catalog');
  const ids = new Set();
  return items.filter((item) => {
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 100 ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      item.name.length > 200 ||
      typeof item.image !== 'string' ||
      !/^\/assets\/[\w./-]+$/.test(item.image) ||
      item.image.includes('..')
    )
      return false;
    ids.add(item.id);
    return true;
  });
}
export function validateRecommendations(data, catalog) {
  if (!data || typeof data.text !== 'string' || !Array.isArray(data.recommendations))
    throw new Error('Invalid recommendations');
  const seen = new Set();
  return {
    text: data.text.slice(0, 8000),
    recommendations: data.recommendations
      .filter((item) => {
        if (
          !item ||
          seen.has(item.itemId) ||
          !catalog.some((c) => c.id === item.itemId) ||
          typeof item.reason !== 'string' ||
          !item.reason.trim()
        )
          return false;
        seen.add(item.itemId);
        return true;
      })
      .slice(0, 6)
      .map((item) => ({ itemId: item.itemId, reason: item.reason.slice(0, 600) })),
  };
}
