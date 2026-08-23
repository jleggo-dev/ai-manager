/**
 * A23 §1a — the consistency invariant, end to end against a real Cadence Postgres.
 *
 * The bug, in the owner's words: "Every day I hit microphone and I say 'I had a venti latte from
 * Starbucks'. And every day the LLM returns nutritional information that changes." So the parse is
 * mocked to DRIFT — a different estimate every call, exactly as a real model does — and the test
 * asserts the logged numbers do not move after the first one.
 *
 * Same harness as API-04: real DB + mocked AI seam, skips cleanly with no CADENCE_* env. USDA
 * enrichment is stubbed out because a unit of consistency should not depend on api.data.gov.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Food, Macros } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a105');

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
// No network in a determinism test: local rows only, so ranking is the only variable.
vi.mock('./food-sources/usda-enrich.ts', () => ({
  enrichFoodsWithUsda: vi.fn(async (_u: string, _q: string, local: Food[]) => local),
  searchFoodsWithUsda: vi.fn(async () => []),
}));

let sql: (typeof import('../db/sql.ts'))['sql'];
let logMeal: (typeof import('./nutrition.ts'))['logMeal'];
let previewMealParse: (typeof import('./nutrition.ts'))['previewMealParse'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

/** The user's OWN pinned foods — shared rows (USDA/OFF) are not this test's business. */
async function ownFoodCount(): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from cadence.foods where owner_user_id = ${USER}`;
  return Number(rows[0]?.n ?? 0);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One parse-meal response — the shape the job returns for a single-item meal. */
function parse(
  name: string,
  est: Macros,
  opts: { qty?: number; unit?: string; confidence?: number; brand?: string } = {},
) {
  return {
    formatted: JSON.stringify({
      meal: 'snack',
      items: [
        {
          name,
          ...(opts.brand ? { brand: opts.brand } : {}),
          ...(opts.qty ? { qty: opts.qty } : {}),
          ...(opts.unit ? { unit: opts.unit } : {}),
          est,
        },
      ],
      confidence: opts.confidence ?? 0.8,
      est_macros: est,
    }),
  };
}

d('A23 — the food ledger keeps a price (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ logMeal, previewMealParse } = await import('./nutrition.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as { runJobBySlug: ReturnType<typeof vi.fn> });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  afterEach(() => {
    runJobBySlug.mockReset();
  });

  /** THE TEST. Three logs, three different model estimates, one price. */
  it('charges the same for the same words even when the model drifts', async () => {
    const drift: Macros[] = [
      { kcal: 190, protein_g: 12, fat_g: 7 },
      { kcal: 250, protein_g: 9, fat_g: 11 },
      { kcal: 220, protein_g: 14, fat_g: 8 },
    ];

    const rows = [];
    for (const est of drift) {
      runJobBySlug.mockResolvedValueOnce(parse('venti latte', est, { qty: 1, unit: 'latte' }));
      rows.push(await logMeal(USER, { text: 'a venti latte from starbucks', date: today() }));
    }

    // The first log sets the price; the drift after it is ignored.
    expect(rows[1]?.macros).toEqual(rows[0]?.macros);
    expect(rows[2]?.macros).toEqual(rows[0]?.macros);
    expect(rows[0]?.macros?.kcal).toBeCloseTo(190, 0);

    // Same food row every time — not three near-duplicates.
    const foodIds = rows.map((r) => r.items[0]?.food_id);
    expect(foodIds[0]).toBeTruthy();
    expect(new Set(foodIds).size).toBe(1);

    expect(await ownFoodCount()).toBe(1);
  });

  it('marks a fully ledger-priced meal as such, and never as provisional', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 190 }, { qty: 1, unit: 'latte' }));
    const first = await logMeal(USER, { text: 'a venti latte', date: today() });
    expect(first.items[0]?.food_id).toBeTruthy();

    // Second time it resolves to the pinned row — and a low-confidence parse no longer matters,
    // because there is no guess left in the numbers.
    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 999 }, { qty: 1, unit: 'latte', confidence: 0.2 }));
    const second = await logMeal(USER, { text: 'a venti latte', date: today() });

    expect(second.macros?.source).toBe('ledger');
    expect(second.macros?.kcal).toBeCloseTo(190, 0);
    expect(second.provisional).toBe(false);
    expect(second.ai_confidence).toBe(0.2);
  });

  it('scales the pinned price with the quantity instead of reusing a flat number', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('egg', { kcal: 70, protein_g: 6 }, { qty: 1, unit: 'egg' }));
    await logMeal(USER, { text: 'an egg', date: today() });

    runJobBySlug.mockResolvedValueOnce(parse('egg', { kcal: 999 }, { qty: 3, unit: 'egg' }));
    const three = await logMeal(USER, { text: '3 eggs', date: today() });

    expect(three.macros?.kcal).toBeCloseTo(210, 0);
    expect(three.macros?.protein_g).toBeCloseTo(18, 0);
  });

  /** Only ONE model call per log: the parse. Pricing and pinning add none. */
  it('adds no model calls to the logging path', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('oat bowl', { kcal: 300 }, { qty: 1, unit: 'bowl' }));
    await logMeal(USER, { text: 'an oat bowl', date: today() });
    expect(runJobBySlug).toHaveBeenCalledTimes(1);

    runJobBySlug.mockResolvedValueOnce(parse('oat bowl', { kcal: 305 }, { qty: 1, unit: 'bowl' }));
    await logMeal(USER, { text: 'an oat bowl', date: today() });
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
    expect(runJobBySlug.mock.calls.every((c) => c[1] === 'parse-meal')).toBe(true);
  });

  /**
   * A meal we could not price must still count everything it counted before. Under-reporting a
   * day is a worse failure than an inconsistent one, so the parse's own total stands.
   */
  it('keeps the parse total when an item cannot be priced or pinned', async () => {
    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        meal: 'lunch',
        items: [{ name: 'mystery stew' }], // no per-item est, and estimate-food will fail below
        confidence: 0.7,
        est_macros: { kcal: 520, protein_g: 25 },
      }),
    });
    runJobBySlug.mockRejectedValueOnce(new Error('estimate-food unavailable'));

    const row = await logMeal(USER, { text: 'some stew', date: today() });

    expect(row.macros?.kcal).toBe(520);
    expect(row.macros?.source).toBe('ai');
    expect(row.items[0]?.food_id).toBeUndefined();
  });

  /**
   * The preview is a READ. It may price from foods already on file, but a card the user walks away
   * from must leave nothing behind — the same rule the two-stage photo read follows.
   */
  it('previewMealParse prices without pinning anything', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 190 }, { qty: 1, unit: 'latte' }));
    const preview = await previewMealParse(USER, 'a venti latte');

    expect(preview.macros?.kcal).toBe(190);
    expect(preview.items[0]?.food_id).toBeUndefined();
    expect(await ownFoodCount()).toBe(0);
  });

  it('previewMealParse prices from a food already on file', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 190 }, { qty: 1, unit: 'latte' }));
    await logMeal(USER, { text: 'a venti latte', date: today() });

    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 260 }, { qty: 1, unit: 'latte' }));
    const preview = await previewMealParse(USER, 'a venti latte');

    expect(preview.items[0]?.food_id).toBeTruthy();
    expect(preview.macros?.kcal).toBeCloseTo(190, 0); // the card shows the ledger, not the new guess
    expect(await ownFoodCount()).toBe(1); // and still no second row
  });

  /**
   * The confirm re-prices server-side because the preview's wire shape drops `food_id`. What lands
   * must still be what the card showed — deterministic pricing is what makes both true at once.
   */
  it('confirming a preview lands the card’s numbers and links the food', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('yogurt parfait', { kcal: 380, protein_g: 14 }, { qty: 1 }));
    const preview = await previewMealParse(USER, 'a yogurt parfait from materia prima');
    expect(await ownFoodCount()).toBe(0);

    // Exactly what the browser posts back: no food_id survives the round trip.
    const row = await logMeal(USER, {
      parsed: {
        meal: preview.meal,
        items: preview.items.map(({ name, qty, unit, est }) => ({ name, qty, unit, est })),
        macros: preview.macros,
        confidence: preview.confidence,
        flags: preview.flags,
        raw_text: preview.raw_text,
        date: today(),
      },
    });

    expect(row.macros?.kcal).toBe(preview.macros?.kcal);
    expect(row.items[0]?.food_id).toBeTruthy();
    expect(await ownFoodCount()).toBe(1);

    // And the next spoken log of the same thing resolves to what the confirm pinned.
    runJobBySlug.mockResolvedValueOnce(parse('yogurt parfait', { kcal: 999 }, { qty: 1 }));
    const later = await logMeal(USER, { text: 'a yogurt parfait', date: today() });
    expect(later.macros?.kcal).toBeCloseTo(380, 0);
    expect(await ownFoodCount()).toBe(1);
  });

  /**
   * A23 §1b — the vendor is what makes a cafe item pinnable as ITSELF. Without it the parfait from
   * the place by the office and any other parfait are one row, and the price stops meaning much.
   */
  it('pins the vendor the parse heard, and keeps it on the log', async () => {
    runJobBySlug.mockResolvedValueOnce(
      parse('yogurt parfait', { kcal: 380 }, { qty: 1, unit: 'parfait', brand: 'Materia Prima' }),
    );
    const row = await logMeal(USER, { text: 'a yogurt parfait from materia prima', date: today() });

    expect(row.items[0]?.brand).toBe('Materia Prima');
    const foods = await sql<{ name: string; brand: string | null }[]>`
      select name, brand from cadence.foods where owner_user_id = ${USER}`;
    expect(foods).toEqual([{ name: 'yogurt parfait', brand: 'Materia Prima' }]);
  });

  it('resolves a later log of the same vendor item to the row it already pinned', async () => {
    runJobBySlug.mockResolvedValueOnce(
      parse('yogurt parfait', { kcal: 380 }, { qty: 1, unit: 'parfait', brand: 'Materia Prima' }),
    );
    const first = await logMeal(USER, { text: 'a parfait from materia prima', date: today() });

    runJobBySlug.mockResolvedValueOnce(
      parse('yogurt parfait', { kcal: 999 }, { qty: 1, unit: 'parfait', brand: 'Materia Prima' }),
    );
    const second = await logMeal(USER, { text: 'a parfait from materia prima', date: today() });

    expect(second.items[0]?.food_id).toBe(first.items[0]?.food_id);
    expect(second.macros?.kcal).toBeCloseTo(380, 0);
    expect(await ownFoodCount()).toBe(1);
  });

  /**
   * REGRESSION (2026-08-22, owner-reported). "I listed out a bunch of basic foods in a chat for my
   * breakfast and it gave me nada back in terms of micronutrients."
   *
   * The model was never the problem — a real breakfast logged that morning carried 6, 3, 6, 2, 0
   * and 6 micronutrients across its items. The confirm card summed FOUR keys into the meal total,
   * the day sums the meal total, and so the Nutrients screen reported that nothing they ate carried
   * mineral data. Fixed on both sides: the card sums every key, and the server recomputes the total
   * from the items regardless, so an old app on a phone gets it without waiting for a rebuild.
   */
  it('carries micronutrients from the items onto the meal total', async () => {
    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        meal: 'breakfast',
        items: [
          { name: 'eggs', qty: 2, unit: 'large', est: { kcal: 140, protein_g: 12, iron_mg: 1.8, vitamin_b12_ug: 1.1 } },
          { name: 'arugula', qty: 1, unit: 'handful', est: { kcal: 5, calcium_mg: 32, vitamin_c_mg: 3.7 } },
        ],
        confidence: 0.8,
        // Exactly what the browser used to post: four keys, no micros.
        est_macros: { kcal: 145, protein_g: 12 },
      }),
    });

    const row = await logMeal(USER, { text: '2 eggs and a handful of arugula', date: today() });

    expect(row.macros?.iron_mg).toBeCloseTo(1.8, 1);
    expect(row.macros?.vitamin_b12_ug).toBeCloseTo(1.1, 1);
    expect(row.macros?.calcium_mg).toBeCloseTo(32, 0);
    expect(row.macros?.vitamin_c_mg).toBeCloseTo(3.7, 1);
  });

  it('carries them through the confirm path too, even from a four-key client total', async () => {
    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        meal: 'breakfast',
        items: [{ name: 'eggs', qty: 2, unit: 'large', est: { kcal: 140, protein_g: 12, iron_mg: 1.8 } }],
        confidence: 0.8,
        est_macros: { kcal: 140, protein_g: 12 },
      }),
    });
    const preview = await previewMealParse(USER, '2 eggs');

    const row = await logMeal(USER, {
      parsed: {
        meal: preview.meal,
        items: preview.items.map(({ name, qty, unit, est }) => ({ name, qty, unit, est })),
        // The old client's total: no micros in it at all.
        macros: { kcal: 140, protein_g: 12 },
        confidence: preview.confidence,
        flags: preview.flags,
        raw_text: preview.raw_text,
        date: today(),
      },
    });

    expect(row.macros?.iron_mg).toBeCloseTo(1.8, 1);
  });

  /**
   * A23 / 2026-08-22, owner: "I can't delete a food I logged — so if I log it by accident, I'm
   * kinda screwed." There was a PATCH to correct a meal and no delete at all. A meal that did not
   * happen is an error, not history, and it was shaping the day's totals with no way out.
   */
  it('takes a meal back off the day, and only the owner’s own', async () => {
    const { removeMeal } = await import('./nutrition.ts');
    runJobBySlug.mockResolvedValueOnce(parse('oat bowl', { kcal: 300 }, { qty: 1, unit: 'bowl' }));
    const row = await logMeal(USER, { text: 'an oat bowl', date: today() });

    expect(await removeMeal(USER, row.log_id)).toBe(true);
    const left = await sql<{ n: string }[]>`
      select count(*)::text as n from cadence.nutrition_logs where user_id = ${USER}`;
    expect(Number(left[0]?.n)).toBe(0);

    // Gone is gone, and a second attempt is an honest "not found" rather than a silent success.
    expect(await removeMeal(USER, row.log_id)).toBe(false);
    // Another user's id cannot reach it either.
    expect(await removeMeal('00000000-0000-4000-a000-0000000000ff', row.log_id)).toBe(false);
  });

  /** Removing the meal must NOT remove the food it pinned — the price stays learned. */
  it('leaves the pinned food behind when a meal is removed', async () => {
    runJobBySlug.mockResolvedValueOnce(parse('venti latte', { kcal: 190 }, { qty: 1, unit: 'latte' }));
    const row = await logMeal(USER, { text: 'a venti latte', date: today() });
    expect(await ownFoodCount()).toBe(1);

    const { removeMeal } = await import('./nutrition.ts');
    await removeMeal(USER, row.log_id);

    expect(await ownFoodCount()).toBe(1);
  });

  it('does not pin anything when the parse itself fails', async () => {
    runJobBySlug.mockResolvedValueOnce({ formatted: 'NOT_JSON{{{' });
    const row = await logMeal(USER, { text: 'oats and berries', date: today() });

    expect(row.provisional).toBe(true);
    expect(row.items).toEqual([]);
    expect(await ownFoodCount()).toBe(0);
  });
});
