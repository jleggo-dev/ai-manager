/**
 * The web-grounded rung's contract: a result better than a guess, or nothing at all.
 *
 * Everything here enforces one asymmetry. This rung's failure mode is not "no answer" — the
 * waterfall already survives that — it is a CONFIDENT WRONG answer, because whatever it returns
 * gets pinned and priced identically forever (A23). So the parser is strict where cached sources
 * are lenient: full macro split or refusal, confidence floor, and the same normalization guard
 * every other source passes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { researchFood, shouldResearchItem, __resetResearchCooldownForTests } from './food-research.ts';

const runJobBySlug = vi.hoisted(() => vi.fn());
vi.mock('../ai/aim.ts', () => ({ runJobBySlug }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));

const GOOD = JSON.stringify({
  name: 'Dill Pickle Peanuts',
  brand: 'The Carolina Nut Co.',
  base_unit: 'g',
  serving_label: '1 oz (28g)',
  serving_amount: 28,
  macros_per_serving: { kcal: 170, protein_g: 7, carbs_g: 7, fat_g: 13 },
  macros_per_100: { kcal: 607, protein_g: 25, carbs_g: 25, fat_g: 46.4, sodium_mg: 821 },
  confidence: 0.85,
  source_url: 'https://carolinanut.com/products/dill-pickle',
});

beforeEach(() => {
  runJobBySlug.mockReset();
  __resetResearchCooldownForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('shouldResearchItem', () => {
  it('fires only for a vendor-named item', () => {
    expect(shouldResearchItem({ brand: 'Couche-Tard' })).toBe(true);
    expect(shouldResearchItem({ brand: null })).toBe(false);
    expect(shouldResearchItem({ brand: ' ' })).toBe(false);
  });

  it('never asks twice — the marker from a previous preview stands', () => {
    expect(shouldResearchItem({ brand: 'Couche-Tard', est: { source: 'research' } })).toBe(false);
  });

  it('never overrules numbers the user set themselves', () => {
    expect(shouldResearchItem({ brand: 'Couche-Tard', est: { source: 'user' } })).toBe(false);
  });
});

describe('researchFood', () => {
  it('shapes a good answer into a pinnable transient food', async () => {
    runJobBySlug.mockResolvedValue({ formatted: GOOD });
    const out = await researchFood('u1', { name: 'dill pickle peanuts', brand: 'Couche-Tard' });
    expect(out).not.toBeNull();
    expect(out!.food.source).toBe('research');
    expect(out!.food.macros_per_base).toMatchObject({ kcal: 607, protein_g: 25 });
    // The label's own serving survives, plus the 100 g everyone gets.
    expect(out!.food.servings.map((s) => s.amount_g)).toEqual([28, 100]);
    expect(out!.source_url).toContain('carolinanut.com');
  });

  it('refuses an answer without the full macro split — that does not beat the estimate', async () => {
    const partial = JSON.parse(GOOD) as Record<string, unknown>;
    partial.macros_per_100 = { kcal: 607, protein_g: 25 };
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify(partial) });
    expect(await researchFood('u1', { name: 'peanuts', brand: 'X' })).toBeNull();
  });

  it('refuses low confidence — wrong-product risk is this rung’s whole failure mode', async () => {
    const shaky = JSON.parse(GOOD) as Record<string, unknown>;
    shaky.confidence = 0.3;
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify(shaky) });
    expect(await researchFood('u1', { name: 'peanuts', brand: 'X' })).toBeNull();
  });

  it('rejects per-serving numbers filed as per-100 — the two views must agree by arithmetic', async () => {
    // Caught on the first live smoke: 160 kcal/100g for PEANUTS — really the per-ounce label.
    // Internally consistent (macros shifted by the same factor), so Atwater passes; only the
    // cross-view arithmetic sees it: 160 × 28/100 = 45, but the label says 160 per serving.
    const shifted = JSON.parse(GOOD) as Record<string, unknown>;
    shifted.macros_per_100 = { kcal: 160, protein_g: 6, carbs_g: 10, fat_g: 11 };
    shifted.macros_per_serving = { kcal: 160, protein_g: 6, carbs_g: 10, fat_g: 11 };
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify(shifted) });
    expect(await researchFood('u1', { name: 'peanuts', brand: 'Couche-Tard' })).toBeNull();
  });

  it('runs an impossible basis through the same guard as every other source', async () => {
    // The Starbucks K-Cup shape: per-package filed as per-100g. If USDA is not allowed to pin
    // that, neither is a web page.
    const corrupt = JSON.parse(GOOD) as Record<string, unknown>;
    corrupt.macros_per_100 = { kcal: 607, protein_g: 50, carbs_g: 262.5, fat_g: 12 };
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify(corrupt) });
    expect(await researchFood('u1', { name: 'latte', brand: 'Starbucks' })).toBeNull();
  });

  it('returns null on garbage, and null on a job failure — the waterfall falls through, never over', async () => {
    runJobBySlug.mockResolvedValue({ formatted: 'I could not find that product, sorry!' });
    expect(await researchFood('u1', { name: 'x', brand: 'Y' })).toBeNull();
    runJobBySlug.mockRejectedValue(new Error('job not provisioned'));
    expect(await researchFood('u1', { name: 'x', brand: 'Y' })).toBeNull();
  });

  it('cools down after a miss — one unfindable product must not tax preview AND log', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ confidence: 0, macros_per_100: {} }) });
    expect(await researchFood('u1', { name: 'mystery snack', brand: 'Couche-Tard' })).toBeNull();
    expect(await researchFood('u1', { name: 'mystery snack', brand: 'Couche-Tard' })).toBeNull();
    expect(runJobBySlug).toHaveBeenCalledTimes(1);
  });

  it('keeps only http(s) source urls', async () => {
    const sneaky = JSON.parse(GOOD) as Record<string, unknown>;
    sneaky.source_url = 'javascript:alert(1)';
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify(sneaky) });
    const out = await researchFood('u1', { name: 'peanuts', brand: 'X' });
    expect(out!.source_url).toBeNull();
  });
});
