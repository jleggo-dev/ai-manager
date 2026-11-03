/**
 * The web rung inside a read answers in one of four ways and never throws: found (pinned, so the
 * row can be picked), nothing (with the job's own reason), failed (with what broke), or no answer
 * in time (and the late answer still pinned). A table, because a fault reading as "nothing found"
 * is the lie this whole path guards against (tool-response.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Food } from '@cadence/shared';
import type { ResearchedFood } from './food-research.ts';
import { WEB_IN_READ_MS, pinResearchedFood, webLookup } from './food-web-lookup.ts';

const found: ResearchedFood = {
  food: {
    food_id: '',
    owner_user_id: null,
    visibility: 'private',
    name: "Rickard's Red Beer",
    brand: "Molson's Brewery of Canada Limited",
    source: 'research',
    off_id: null,
    fdc_id: null,
    base_unit: 'ml',
    macros_per_base: { kcal: 46.8, protein_g: 0, carbs_g: 2.39, fat_g: 0 },
    servings: [
      { label: '1 pint (473 ml)', unit: '1 pint (473 ml)', amount_g: 473 },
      { label: '100 ml', unit: 'ml', amount_g: 100 },
    ],
    default_serving: 0,
    confidence: 0.8,
    photo_ref: null,
    created_at: '',
  },
  source_url: 'https://example.test/rickards',
  alternates: [],
};
const stored: Food = { ...found.food, food_id: 'f-rickards', owner_user_id: 'u1', created_at: '2026-11-03' };
const lookup = { q: 'red beer', measure: '1 pint', brand: "Rickard's" };

afterEach(() => vi.useRealTimers());

describe('webLookup — one lookup on the web, said honestly', () => {
  it('found: the researched food is pinned first, then offered as a row that can be picked', async () => {
    const research = vi.fn(async () => ({ result: found, reason: null }));
    const pin = vi.fn(async () => stored);
    const r = await webLookup('u1', { research, pin, boundMs: 1000 })(lookup);
    expect(research).toHaveBeenCalledWith('u1', { name: 'red beer', brand: "Rickard's" });
    expect(pin).toHaveBeenCalledWith('u1', found);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ source: 'research', food_id: 'f-rickards', name: "Rickard's Red Beer" });
    // Priced at the measure she asked about, from the record's own list.
    expect(r.rows[0]?.per.measure).toBe('1 pint (473 ml)');
    expect(r.rows[0]?.per.nutrients.kcal).toBeCloseTo(221, 0);
    // Beside the source's own notes (an estimate, the alcohol calories the macros do not show).
    expect(r.rows[0]?.notes).toContain('found on the web for "Rickard\'s — red beer"');
    expect(r.check).toMatchObject({ source: 'research', status: 'hit' });
    expect(r.check.detail).toBe(
      'found "Rickard\'s Red Beer (Molson\'s Brewery of Canada Limited)", kept as your private food',
    );
  });

  it.each([
    [
      'nothing: the job refused, and its reason is the line',
      async () => ({
        result: null,
        reason: 'refused — confidence 0.35 is below the 0.4 floor this rung holds itself to',
      }),
      'miss',
      /^refused — confidence 0\.35 is below the 0\.4 floor/,
    ],
    [
      'failed: the job threw, and what broke is the line',
      async () => {
        throw new Error('research-food timed out after 240000ms');
      },
      'error',
      /^research-food timed out/,
    ],
  ] as const)('%s', async (_, research, status, detail) => {
    const pin = vi.fn();
    const r = await webLookup('u1', { research, pin, boundMs: 1000 })(lookup);
    expect(r.rows).toEqual([]);
    expect(r.check.status).toBe(status);
    expect(r.check.detail).toMatch(detail);
    expect(pin).not.toHaveBeenCalled();
  });

  it('found but the pin failed: no row (it could not be logged), and the line says so', async () => {
    const research = vi.fn(async () => ({ result: found, reason: null }));
    const pin = vi.fn(async () => null);
    const r = await webLookup('u1', { research, pin, boundMs: 1000 })(lookup);
    expect(r.rows).toEqual([]);
    expect(r.check.status).toBe('error');
    expect(r.check.detail).toMatch(/found "Rickard's Red Beer .*" but could not keep it on file/);
  });

  it('no answer in time: the read moves on, says so, and the late answer is still pinned', async () => {
    vi.useFakeTimers();
    let answer!: (o: { result: ResearchedFood | null; reason: string | null }) => void;
    const research = vi.fn(
      () => new Promise<{ result: ResearchedFood | null; reason: string | null }>((res) => (answer = res)),
    );
    const pin = vi.fn(async () => stored);
    const p = webLookup('u1', { research, pin, boundMs: 60_000 })(lookup);
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r.rows).toEqual([]);
    expect(r.check).toMatchObject({ status: 'error', detail: 'no answer within 60 s; kept on file if it comes back' });
    expect(pin).not.toHaveBeenCalled();
    answer({ result: found, reason: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(pin).toHaveBeenCalledWith('u1', found);
  });

  it('the bound a read waits on the web is a minute: long enough for the measured answers, short enough to tell', () => {
    expect(WEB_IN_READ_MS).toBe(60_000);
  });
});

describe('pinResearchedFood — kept as this person’s private food', () => {
  it('inserts a private research food with the researched numbers and measures', async () => {
    const insertFood = vi.fn(async () => stored);
    const findOwnDuplicate = vi.fn(async () => null);
    const f = await pinResearchedFood('u1', found, { findOwnDuplicate, insertFood });
    expect(f).toBe(stored);
    expect(insertFood).toHaveBeenCalledWith('u1', {
      name: "Rickard's Red Beer",
      brand: "Molson's Brewery of Canada Limited",
      source: 'research',
      visibility: 'private',
      base_unit: 'ml',
      macros_per_base: { kcal: 46.8, protein_g: 0, carbs_g: 2.39, fat_g: 0 },
      servings: found.food.servings,
      default_serving: 0,
      confidence: 0.8,
    });
  });

  it('one of theirs that already matches is reused as it is, never overwritten', async () => {
    const theirs: Food = { ...stored, food_id: 'f-theirs', source: 'llm' };
    const insertFood = vi.fn();
    const findOwnDuplicate = vi.fn(async () => theirs);
    const f = await pinResearchedFood('u1', found, { findOwnDuplicate, insertFood });
    expect(f).toBe(theirs);
    expect(findOwnDuplicate).toHaveBeenCalledWith('u1', "Rickard's Red Beer", "Molson's Brewery of Canada Limited");
    expect(insertFood).not.toHaveBeenCalled();
  });

  it('a pin that fails is null, not a throw — the read goes on without the row', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insertFood = vi.fn(async () => {
      throw new Error('db down');
    });
    const f = await pinResearchedFood('u1', found, { findOwnDuplicate: async () => null, insertFood });
    expect(f).toBeNull();
    warn.mockRestore();
  });
});
