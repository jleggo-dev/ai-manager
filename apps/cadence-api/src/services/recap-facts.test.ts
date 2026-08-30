/**
 * `buildRecapFacts`/`buildFactsLine` are pure — real assertions, no mocking (same "assert the
 * card, not the prose" reasoning week-review-diff.test.ts states for its own pure function). The
 * 0046 migration is NOT applied anywhere this suite runs, so nothing here touches
 * `cadence.recaps` — these are the only tests for the new recap-persistence logic.
 */
import { describe, expect, it } from 'vitest';
import { buildFactsLine, buildRecapFacts, type RecapFacts } from './recap-facts.ts';
import type { WeekReviewDay, WeekReviewFacts, WeekReviewMealSlot, WeekReviewSessionRow } from './week-review-facts.ts';

const MEAL_NAMES = ['breakfast', 'lunch', 'dinner'] as const;

function meals(date: string, logged: Partial<Record<(typeof MEAL_NAMES)[number], boolean>> = {}): WeekReviewMealSlot[] {
  return MEAL_NAMES.map((meal) => ({ meal, occurrence_id: `${date}-${meal}`, logged: logged[meal] ?? false }));
}

function day(date: string, over: Partial<WeekReviewDay> = {}): WeekReviewDay {
  return { date, sessions: [], meals: meals(date), mind: [], ...over };
}

function session(over: Partial<WeekReviewSessionRow> = {}): WeekReviewSessionRow {
  return { occurrence_id: 's1', title: 'Easy run', status: 'pending', ...over };
}

function facts(days: WeekReviewDay[]): WeekReviewFacts {
  return { period: { from: days[0]!.date, to: days[days.length - 1]!.date }, days, weigh_in: null };
}

describe('buildRecapFacts', () => {
  it('counts kept/scheduled sessions and logged/total meals across the week', () => {
    const week = facts([
      day('2026-08-17', {
        sessions: [
          session({ occurrence_id: 's1', status: 'done' }),
          session({ occurrence_id: 's2', status: 'missed' }),
        ],
        meals: meals('2026-08-17', { breakfast: true, lunch: true, dinner: false }),
      }),
      day('2026-08-18', {
        sessions: [session({ occurrence_id: 's3', status: 'done' })],
        meals: meals('2026-08-18', { breakfast: true, lunch: false, dinner: false }),
      }),
    ]);

    const recap = buildRecapFacts(week, null, 'lb');

    expect(recap.sessions).toEqual({ kept: 2, scheduled: 3 });
    expect(recap.meals).toEqual({ logged: 3, total: 6 });
    expect(recap.weigh_in).toBeNull();
  });

  it('reports zero-scheduled weeks honestly rather than a false total', () => {
    const week = facts([day('2026-08-17')]);
    const recap = buildRecapFacts(week, null, 'kg');
    expect(recap.sessions).toEqual({ kept: 0, scheduled: 0 });
    expect(recap.meals).toEqual({ logged: 0, total: 3 });
  });

  it('stores a present weigh-in trend in kg regardless of display unit, rounded to 1 decimal', () => {
    const week = facts([day('2026-08-17')]);
    const recap = buildRecapFacts(week, -0.1834, 'lb');
    expect(recap.weigh_in).toEqual({ delta_kg: -0.2, unit: 'lb' });
  });

  it('leaves weigh_in null when the caller had no trustable trend to hand it', () => {
    const week = facts([day('2026-08-17')]);
    const recap = buildRecapFacts(week, null, 'kg');
    expect(recap.weigh_in).toBeNull();
  });
});

describe('buildFactsLine', () => {
  it('joins sessions, meals, and a signed weight delta converted to the display unit', () => {
    const recap: RecapFacts = {
      sessions: { kept: 4, scheduled: 5 },
      meals: { logged: 19, total: 21 },
      weigh_in: { delta_kg: -0.1814, unit: 'lb' }, // -0.4 lb
    };
    expect(buildFactsLine(recap)).toBe('showed up 4 of 5 · 19 of 21 meals · -0.4 lb');
  });

  it('omits the sessions clause when nothing was scheduled', () => {
    const recap: RecapFacts = { sessions: { kept: 0, scheduled: 0 }, meals: { logged: 19, total: 21 }, weigh_in: null };
    expect(buildFactsLine(recap)).toBe('19 of 21 meals');
  });

  it('omits the meals clause when no meal slots materialized', () => {
    const recap: RecapFacts = { sessions: { kept: 4, scheduled: 5 }, meals: { logged: 0, total: 0 }, weigh_in: null };
    expect(buildFactsLine(recap)).toBe('showed up 4 of 5');
  });

  it('omits the weigh-in clause when absent, never a fabricated 0', () => {
    const recap: RecapFacts = { sessions: { kept: 4, scheduled: 5 }, meals: { logged: 19, total: 21 }, weigh_in: null };
    expect(buildFactsLine(recap)).toBe('showed up 4 of 5 · 19 of 21 meals');
  });

  it('falls back to a plain, brand-safe line when every part is absent', () => {
    const recap: RecapFacts = { sessions: { kept: 0, scheduled: 0 }, meals: { logged: 0, total: 0 }, weigh_in: null };
    expect(buildFactsLine(recap)).toBe('nothing logged this week');
  });

  it('renders a gain as a plain positive number, never a verdict either way', () => {
    const recap: RecapFacts = {
      sessions: { kept: 5, scheduled: 5 },
      meals: { logged: 21, total: 21 },
      weigh_in: { delta_kg: 0.3, unit: 'kg' },
    };
    expect(buildFactsLine(recap)).toBe('showed up 5 of 5 · 21 of 21 meals · +0.3 kg');
  });

  it('renders no change with no sign', () => {
    const recap: RecapFacts = {
      sessions: { kept: 5, scheduled: 5 },
      meals: { logged: 21, total: 21 },
      weigh_in: { delta_kg: 0, unit: 'kg' },
    };
    expect(buildFactsLine(recap)).toBe('showed up 5 of 5 · 21 of 21 meals · 0 kg');
  });
});
