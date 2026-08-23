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
import { searchUsdaFoods, usdaDataTypesFor } from '../src/services/food-sources/usda.ts';
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
    /**
     * Through `searchUsdaFoods` WITH the gate's own dataType list — not a bare query string.
     *
     * The sweep used to call the search endpoint directly, which meant it never sent a dataType
     * and never exercised the path the app actually uses. Adding 'Survey (FNDDS)' to that list
     * made every whole-food search 400, and this sweep reported 49/49 healthy while it happened.
     * A smoke test that skips the gate is testing something nobody runs.
     */
    const brandish = /starbucks|mcdonald|subway|chipotle|doritos|oreo|cheerios|skippy|clif|gatorade|planters/i.test(q);
    const hits = await tryHard(() =>
      searchUsdaFoods(q, { pageSize: 3, dataTypes: usdaDataTypesFor(brandish ? 'a vendor' : null) }),
    );
    const ids = (hits ?? []).map((h) => h.fdc_id);
    if (!ids.length) { rows.push({ source: 'usda', query: q, name: '—', micros: 0, problems: ['no search result'] }); continue; }
    // Keep going past a record the guard rejects — that is what the resolver does, and a source
    // publishing one corrupt row (USDA has a Starbucks K-Cup at 262.5 g carbs per 100 g) is not
    // the same as a source having nothing. Reporting it as a failure would train us to ignore
    // this sweep, which is the one thing it cannot survive.
    let done = false;
    const rejected: string[] = [];
    for (const id of ids) {
      const raw = await tryHard(() => usdaGet(`/food/${id}`), 2);
      if (!raw) continue;
      const m = mapUsdaFoodDetail(raw);
      if (!m) { rejected.push(String(id)); continue; }
      const row = summarise('usda', q, m as never);
      if (rejected.length) row.problems.push(`note: skipped ${rejected.length} rejected record(s)`);
      rows.push(row);
      done = true;
      break;
    }
    if (!done) {
      rows.push({
        source: 'usda',
        query: q,
        name: '—',
        micros: 0,
        problems: [rejected.length ? `no usable record in ${ids.length} tried` : 'no detail reachable'],
      });
    }
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
  /**
   * "This source doesn't have that food" is a normal answer — the next rung exists for it. Only
   * "the source answered and we could not read it" is a defect. Conflating them is how a sweep
   * starts crying wolf and stops being read.
   */
  const missing = rows.filter((r) => r.problems.some((p) => p.startsWith('no ')));
  const bad = rows.filter((r) =>
    r.problems.some((p) => !p.startsWith('warn:') && !p.startsWith('note:') && !p.startsWith('no ')),
  );
  const warned = rows.filter((r) => r.problems.some((p) => p.startsWith('warn:')));
  const noKcal = rows.filter((r) => r.kcal === undefined && !r.problems.length);
  const noMicros = rows.filter((r) => r.micros === 0 && !r.problems.length);

  console.log(`\n${'='.repeat(72)}`);
  console.log(
    `${rows.length} foods swept · ${bad.length} unreadable · ${missing.length} not in this source · ` +
      `${warned.length} suspicious · ${noKcal.length} without calories · ${noMicros.length} without any micronutrient`,
  );

  if (bad.length) {
    console.log('\nUNREADABLE — the source answered and the adapter could not use it. This is OUR bug:');
    for (const r of bad) console.log(`  [${r.source}] "${r.query}" → ${r.name}\n      ${r.problems.join('\n      ')}`);
  }
  if (missing.length) {
    console.log('\nnot in this source (normal — the next rung answers):');
    for (const r of missing) console.log(`  [${r.source}] "${r.query}"`);
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
