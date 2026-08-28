import { describe, it, expect } from 'vitest';
import { CHECK_FOOD_SOURCES } from './food-sources-function.ts';
import { RESOLVE_PORTION } from './portion-function.ts';
import type { FanOutResult } from '../food-source-fanout.ts';
import type { SourceCandidate } from '../food-source-report.ts';

/**
 * What `check_food_sources` HANDS BACK — the half TOOL-HARNESS step 4 governs, and the half that
 * shipped with two defects on 2026-08-23.
 *
 * Both were the same shape as bugs this codebase has already paid for once: something that went
 * wrong wearing the clothes of something ordinary. A crashed lookup rendered as a usage hint, so
 * the Coach would be told she had passed bad arguments when the search had actually broken. And a
 * candidate never printed its `food_id`, so the note telling her to call `resolve_portion` pointed
 * at a tool she had no way to address — a follow-up named without the key it needs.
 */

const candidate = (over: Partial<SourceCandidate> = {}): SourceCandidate =>
  ({
    source: 'usda',
    food_id: 'usda-shallots',
    name: 'Shallots, raw',
    brand: null,
    per: { measure: '100 g', grams: 100, nutrients: { kcal: 72, protein_g: 2.5 } },
    measures: [{ label: '100 g', grams: 100 }],
    micros: 'measured',
    completeness: 'macros',
    notes: [],
    ...over,
  }) as SourceCandidate;

const result = (over: Partial<FanOutResult> = {}): FanOutResult => ({
  query: 'shallots',
  brand: null,
  requested_measure: null,
  candidates: [candidate()],
  sources_checked: [{ source: 'ledger', status: 'miss', ms: 4, detail: 'nothing on file yet' }],
  disagreements: [],
  ...over,
});

describe('a fault never wears the clothes of a usage mistake', () => {
  /**
   * `executeCalls` logs a throwing `run` and leaves `results[name]` UNSET, so render is called with
   * `undefined`. Returning the usage hint there was a lie in her voice — the same failure that once
   * told a user with thirty recorded workouts that he had none.
   */
  it('says the databases could not be read when the lookup crashed', () => {
    const out = CHECK_FOOD_SOURCES.render(undefined);
    expect(out).toMatch(/could not be read/i);
    expect(out).toMatch(/NOT an empty record/i);
    expect(out).not.toMatch(/pass q/i);
  });

  it('still gives the usage hint when no query was passed', () => {
    // `run` returns null for a missing q — a real usage case, and a different answer.
    expect(CHECK_FOOD_SOURCES.render(null)).toMatch(/pass q/i);
  });

  it('shares no wording between the two, so a skim cannot confuse them', () => {
    const fault = CHECK_FOOD_SOURCES.render(undefined).toLowerCase();
    const usage = CHECK_FOOD_SOURCES.render(null).toLowerCase();
    const overlap = usage
      .split(/\W+/)
      .filter((w) => w.length > 4)
      .filter((w) => fault.includes(w));
    expect(overlap).toEqual([]);
  });
});

describe('the tools can actually be chained', () => {
  /** `resolve_portion` requires a food_id; without it printed here, she cannot call the follow-up. */
  it('prints the food_id of every candidate', () => {
    const out = CHECK_FOOD_SOURCES.render(result());
    expect(out).toContain('food_id usda-shallots');
  });

  it('says so plainly when a candidate has no id yet, rather than printing nothing', () => {
    const out = CHECK_FOOD_SOURCES.render(result({ candidates: [candidate({ food_id: null })] }));
    expect(out).toContain('not saved yet');
  });

  /** The note that names the follow-up, and the id it needs, must appear together. */
  it('prints an id beside the note telling her to resolve the portion', () => {
    const out = CHECK_FOOD_SOURCES.render(
      result({
        requested_measure: '1/4 cup',
        candidates: [candidate({ notes: ['This source has no "1/4 cup" measure — use resolve_portion.'] })],
      }),
    );
    expect(out).toContain('resolve_portion');
    expect(out).toContain('food_id usda-shallots');
  });

  it('names food_id as a required parameter in its own description', () => {
    expect(RESOLVE_PORTION.description).toContain('food_id');
  });
});

describe('the empty answer stays a real answer', () => {
  it('says nothing was found and what to do next, without sounding like a fault', () => {
    const out = CHECK_FOOD_SOURCES.render(result({ candidates: [] }));
    expect(out).toMatch(/No source has "shallots"/);
    expect(out).toMatch(/web lookup/i);
    expect(out).not.toMatch(/could not be read/i);
  });

  it('renders the trace with every source that was checked', () => {
    const out = CHECK_FOOD_SOURCES.render(
      result({
        sources_checked: [
          { source: 'ledger', status: 'hit', ms: 12, detail: '1 already on file' },
          { source: 'usda', status: 'skipped', ms: 0, detail: 'not configured here (no USDA_API_KEY)' },
          { source: 'fatsecret', status: 'skipped', ms: 0, detail: 'not requested — billed per call' },
        ],
      }),
    );
    expect(out).toContain('ledger: hit (12ms)');
    expect(out).toContain('usda: skipped');
    expect(out).toContain('not configured');
    expect(out).toContain('fatsecret: skipped');
  });
});
