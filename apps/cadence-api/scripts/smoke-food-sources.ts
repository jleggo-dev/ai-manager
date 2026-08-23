/**
 * A live conformance sweep across both food sources — the check no user could ever run themselves.
 *
 * A wrong nutrient in a food database is undetectable in normal use. Nobody weighs their lunch
 * against a lab, and the app states every number with the same confidence whether it came from a
 * measurement, a mis-read field, or nothing at all. Every bug this stack has had was invisible for
 * exactly that reason: USDA's Branded records mapped to no nutrients, Foundation foods imported
 * with zero calories, FatSecret's absent micros arrived as confident zeroes. None of them threw.
 *
 * So the repo validates instead of the user. This drives REAL API calls across a deliberately
 * awkward spread — whole foods, packaged goods, restaurant items, drinks, supplements, baby food,
 * alcohol, non-Latin names — and reports what the adapters actually produced. It is not a unit
 * test: it costs quota, it needs credentials, and it is allowed to be slow.
 *
 *     npx tsx scripts/smoke-food-sources.ts            # both sources
 *     npx tsx scripts/smoke-food-sources.ts usda       # one
 *
 * Exit code is 1 if any food came back unusable, so CI could gate on it if we ever want that.
 */
import { usdaGet } from '../src/services/food-sources/usda-http.ts';
import { mapUsdaFoodDetail } from '../src/services/food-sources/usda-map.ts';
import { fatSecretCall, isFatSecretConfigured } from '../src/services/food-sources/fatsecret-http.ts';
import { mapFatSecretFood } from '../src/services/food-sources/fatsecret-map.ts';
import { checkNormalizedFood, type NormalizedFood } from '../src/services/food-sources/normalized.ts';
import { isUsdaConfigured } from '../src/services/food-sources/usda.ts';

/**
 * Chosen to be AWKWARD, not typical. Each group has broken something or plausibly could:
 * whole foods (Atwater-only energy), packaged (legacy numbering), restaurant (fluid-ounce
 * servings), drinks (energy without macros), supplements (micros in odd units), alcohol (energy
 * that is not a macro), non-Latin names (encoding), and foods with a comma in the name — the
 * shape that split one pack of peanuts into two foods.
 */
const QUERIES = [
  // whole foods
  'peanuts raw', 'broccoli raw', 'chicken breast', 'salmon atlantic', 'egg', 'spinach raw',
  'sweet potato', 'quinoa cooked', 'lentils', 'avocado', 'brown rice cooked', 'oats rolled',
  // dairy + fats
  'whole milk', 'cheddar cheese', 'greek yogurt', 'olive oil', 'butter', 'almonds',
  // packaged
  'oreo cookies', 'doritos nacho cheese', 'cheerios', 'skippy peanut butter', 'campbells tomato soup',
  'clif bar', 'pop tarts', 'goldfish crackers',
  // restaurant
  'starbucks caffe latte', 'mcdonalds big mac', 'chipotle chicken burrito bowl', 'subway turkey',
  // drinks
  'coca cola', 'gatorade', 'red bull', 'orange juice', 'almond milk unsweetened',
  // alcohol
  'beer regular', 'red wine', 'vodka',
  // supplements + special
  'whey protein powder', 'centrum multivitamin', 'infant formula', 'ensure',
  // names that are their own hazard
  'kimchi', 'hummus', 'tahini', 'pad thai', 'crème fraîche', 'jalapeño peppers',
  'dill pickles, seasoned peanuts',
];

interface Row { source: string; query: string; name: string; kcal?: number; micros: number; problems: string[]; }

async function tryHard<T>(fn: () => Promise<T>, n = 6): Promise<T | null> {
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return null;
}

const MICRO_KEYS = ['sodium_mg', 'iron_mg', 'zinc_mg', 'vitamin_c_mg', 'calcium_mg', 'potassium_mg', 'vitamin_b12_ug'];

function summarise(source: string, query: string, food: NormalizedFood & { macros_per_base: Record<string, number> }): Row {
  return {
    source,
    query,
    name: food.name,
    ...(typeof food.macros_per_base.kcal === 'number' ? { kcal: food.macros_per_base.kcal } : {}),
    micros: MICRO_KEYS.filter((k) => food.macros_per_base[k] !== undefined).length,
    problems: checkNormalizedFood(food).map((p) => `${p.severity}: ${p.detail}`),
  };
}

async function sweepUsda(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const q of QUERIES) {
    const s = (await tryHard(() => usdaGet(`/foods/search?query=${encodeURIComponent(q)}&pageSize=3`))) as
      | { foods?: Array<{ fdcId: number }> }
      | null;
    const ids = (s?.foods ?? []).map((f) => f.fdcId);
    if (!ids.length) { rows.push({ source: 'usda', query: q, name: '—', micros: 0, problems: ['no search result'] }); continue; }
    let done = false;
    for (const id of ids) {
      const raw = await tryHard(() => usdaGet(`/food/${id}`), 2);
      if (!raw) continue;
      const m = mapUsdaFoodDetail(raw);
      if (!m) { rows.push({ source: 'usda', query: q, name: `fdc:${id}`, micros: 0, problems: ['UNMAPPABLE'] }); done = true; break; }
      rows.push(summarise('usda', q, m as never));
      done = true;
      break;
    }
    if (!done) rows.push({ source: 'usda', query: q, name: '—', micros: 0, problems: ['no detail reachable'] });
  }
  return rows;
}

async function sweepFatSecret(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const q of QUERIES) {
    const s = (await tryHard(() =>
      fatSecretCall({ method: 'foods.search', search_expression: q, max_results: '1' }),
    )) as { foods?: { food?: unknown } } | null;
    const first = Array.isArray(s?.foods?.food) ? s?.foods?.food[0] : s?.foods?.food;
    const id = (first as { food_id?: string } | undefined)?.food_id;
    if (!id) { rows.push({ source: 'fatsecret', query: q, name: '—', micros: 0, problems: ['no search result'] }); continue; }
    const detail = await tryHard(() => fatSecretCall({ method: 'food.get.v4', food_id: id }), 2);
    const m = detail ? mapFatSecretFood(detail) : null;
    if (!m) { rows.push({ source: 'fatsecret', query: q, name: `id:${id}`, micros: 0, problems: ['UNMAPPABLE'] }); continue; }
    rows.push(summarise('fatsecret', q, m as never));
  }
  return rows;
}

function report(rows: Row[]): number {
  const bad = rows.filter((r) => r.problems.some((p) => !p.startsWith('warn:')));
  const warned = rows.filter((r) => r.problems.some((p) => p.startsWith('warn:')));
  const noKcal = rows.filter((r) => r.kcal === undefined && !r.problems.length);
  const noMicros = rows.filter((r) => r.micros === 0 && !r.problems.length);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${rows.length} foods swept · ${bad.length} unusable · ${warned.length} suspicious · ` +
    `${noKcal.length} without calories · ${noMicros.length} without any micronutrient`);

  if (bad.length) {
    console.log('\nUNUSABLE — an adapter could not produce a food we would trust:');
    for (const r of bad) console.log(`  [${r.source}] "${r.query}" → ${r.name}\n      ${r.problems.join('\n      ')}`);
  }
  if (warned.length) {
    console.log('\nSUSPICIOUS — kept, but worth a human eye:');
    for (const r of warned) console.log(`  [${r.source}] ${r.name} — ${r.problems.join('; ')}`);
  }
  if (noKcal.length) {
    console.log('\nNO CALORIES — these log as nothing; every one is either a source gap or our bug:');
    for (const r of noKcal) console.log(`  [${r.source}] "${r.query}" → ${r.name}`);
  }

  const withMicros = rows.filter((r) => r.micros > 0).length;
  console.log(`\nmicronutrient coverage: ${withMicros}/${rows.length} foods carry at least one`);
  console.log('='.repeat(72));
  return bad.length;
}

const which = process.argv[2];
const rows: Row[] = [];
if (which !== 'fatsecret') {
  if (!isUsdaConfigured()) console.warn('USDA_API_KEY not set — skipping USDA');
  else { console.log('sweeping USDA…'); rows.push(...(await sweepUsda())); }
}
if (which !== 'usda') {
  if (!isFatSecretConfigured()) console.warn('FatSecret credentials not set — skipping FatSecret');
  else { console.log('sweeping FatSecret…'); rows.push(...(await sweepFatSecret())); }
}
process.exit(report(rows) > 0 ? 1 : 0);
