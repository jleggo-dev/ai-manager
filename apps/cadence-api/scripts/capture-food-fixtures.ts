/**
 * Record REAL API responses as adapter fixtures.
 *
 * Hand-written fixtures test the adapter against what we imagined the source sends, which is the
 * belief that produced every bug in this stack: USDA's legacy numbering, Foundation's missing
 * Energy row, FatSecret's zero-means-absent. Each one hid because the fixtures agreed with the
 * code. So the fixtures come from the wire.
 *
 * Run when adding a source, or when one changes shape:
 *     npx tsx scripts/capture-food-fixtures.ts
 *
 * The foods are chosen to stress the mapping rather than to be typical — a Foundation food that
 * reports energy only as Atwater factors, a Branded food on the legacy numbering, a restaurant
 * item measured in fluid ounces, a food with micros and one without.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usdaGet } from '../src/services/food-sources/usda-http.ts';
import { fatSecretCall } from '../src/services/food-sources/fatsecret-http.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/services/food-sources/__fixtures__');

async function tryHard<T>(fn: () => Promise<T>, n = 8): Promise<T | null> {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === n - 1) console.warn('  gave up:', e instanceof Error ? e.message.slice(0, 80) : e);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

const USDA_CASES: Array<[string, string, string]> = [
  ['usda-foundation-atwater', 'peanuts raw', 'Foundation'],
  ['usda-branded-legacy', 'planters dry roasted peanuts', 'Branded'],
  ['usda-sr-legacy-full', 'peanut butter', 'SR Legacy'],
];

const FATSECRET_CASES: Array<[string, string]> = [
  ['fatsecret-branded', 'Starbucks Caffe Latte'],
  ['fatsecret-generic', 'banana'],
];

const out: Record<string, unknown> = {};

for (const [name, query, dataType] of USDA_CASES) {
  console.log('usda:', query, `(${dataType})`);
  const search = (await tryHard(() =>
    usdaGet(`/foods/search?query=${encodeURIComponent(query)}&pageSize=1&dataType=${encodeURIComponent(dataType)}`),
  )) as { foods?: Array<{ fdcId: number }> } | null;
  const id = search?.foods?.[0]?.fdcId;
  if (!id) { console.warn('  no hit — skipped'); continue; }
  const detail = await tryHard(() => usdaGet(`/food/${id}`));
  if (!detail) { console.warn('  no detail — skipped'); continue; }
  out[name] = { search, detail };
}

for (const [name, query] of FATSECRET_CASES) {
  console.log('fatsecret:', query);
  const search = (await tryHard(() =>
    fatSecretCall({ method: 'foods.search', search_expression: query, max_results: '1' }),
  )) as { foods?: { food?: unknown } } | null;
  if (!search) { console.warn('  no search — skipped'); continue; }
  const first = Array.isArray(search.foods?.food) ? search.foods.food[0] : search.foods?.food;
  const id = (first as { food_id?: string } | undefined)?.food_id;
  if (!id) { console.warn('  no hit — skipped'); continue; }
  const detail = await tryHard(() => fatSecretCall({ method: 'food.get.v4', food_id: id }));
  if (!detail) { console.warn('  no detail — skipped'); continue; }
  out[name] = { search, detail };
}

for (const [name, body] of Object.entries(out)) {
  const file = path.join(DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  console.log('wrote', path.basename(file));
}
process.exit(0);
