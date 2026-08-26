/**
 * `diffWeekReview` is what turns a pile of toggles into the receipt DESIGN-check-in.md specs:
 * "5 of 5 sessions · 18 of 21 meals · 3 corrections". Pure function, real assertions — no mocking
 * needed, which is exactly why it was worth keeping pure (DESIGN-check-in.md: "assert the card, not
 * the prose").
 */
import { describe, expect, it } from 'vitest';
import { diffWeekReview } from './week-review-diff.ts';
import type {
  WeekReviewDay,
  WeekReviewFacts,
  WeekReviewMealSlot,
  WeekReviewMindRow,
  WeekReviewSessionRow,
} from './week-review-facts.ts';

const MEAL_NAMES = ['breakfast', 'lunch', 'dinner'] as const;

function meals(date: string, logged: Partial<Record<(typeof MEAL_NAMES)[number], boolean>> = {}): WeekReviewMealSlot[] {
  return MEAL_NAMES.map((meal) => ({ meal, occurrence_id: `${date}-${meal}`, logged: logged[meal] ?? false }));
}

function day(date: string, over: Partial<WeekReviewDay> = {}): WeekReviewDay {
  return { date, sessions: [], meals: meals(date), mind: [], ...over };
}

function facts(days: WeekReviewDay[]): WeekReviewFacts {
  return { period: { from: days[0]!.date, to: days[days.length - 1]!.date }, days, weigh_in: null };
}

function session(over: Partial<WeekReviewSessionRow> = {}): WeekReviewSessionRow {
  return { occurrence_id: 's1', title: 'Easy run', status: 'pending', ...over };
}

function mindRow(over: Partial<WeekReviewMindRow> = {}): WeekReviewMindRow {
  return { occurrence_id: 'm1', title: 'Morning practice', status: 'pending', ...over };
}

describe('diffWeekReview', () => {
  it('reports zero corrections when nothing changed', () => {
    const before = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 30 })] })]);
    const after = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 30 })] })]);
    const result = diffWeekReview(before, after);
    expect(result.corrections).toBe(0);
    expect(result.summary.corrections).toBe(0);
  });

  it('counts a session status flip once', () => {
    const before = facts([day('2026-08-24', { sessions: [session({ status: 'pending' })] })]);
    const after = facts([day('2026-08-24', { sessions: [session({ status: 'done' })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(1);
  });

  it('counts a minutes edit on an unchanged status separately from a status flip', () => {
    const before = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 30 })] })]);
    const after = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 45 })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(1);
  });

  it('counts a status flip AND a minutes edit on the same row as two corrections', () => {
    const before = facts([day('2026-08-24', { sessions: [session({ status: 'pending', logged_min: undefined })] })]);
    const after = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 45 })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(2);
  });

  it('counts a meal flip once', () => {
    const before = facts([day('2026-08-24', { meals: meals('2026-08-24', { breakfast: false }) })]);
    const after = facts([day('2026-08-24', { meals: meals('2026-08-24', { breakfast: true }) })]);
    expect(diffWeekReview(before, after).corrections).toBe(1);
  });

  /** Meal slots are keyed by (date, meal), not occurrence_id — a slot goes from a null id to a real
   *  one the first time it's toggled, and that first toggle must still count. */
  it('counts a meal flip even when the occurrence_id only appears in "after"', () => {
    const before = facts([day('2026-08-24', { meals: [{ meal: 'breakfast', occurrence_id: null, logged: false }] })]);
    const after = facts([day('2026-08-24', { meals: [{ meal: 'breakfast', occurrence_id: 'new-id', logged: true }] })]);
    expect(diffWeekReview(before, after).corrections).toBe(1);
  });

  it('counts each flipped mind step once, when the row has named steps', () => {
    const before = facts([
      day('2026-08-24', {
        mind: [
          mindRow({
            steps: [
              { name: 'Settle', done: false },
              { name: 'Breathe', done: true },
            ],
          }),
        ],
      }),
    ]);
    const after = facts([
      day('2026-08-24', {
        mind: [
          mindRow({
            steps: [
              { name: 'Settle', done: true },
              { name: 'Breathe', done: false },
            ],
          }),
        ],
      }),
    ]);
    // Both steps flipped — two genuinely changed values.
    expect(diffWeekReview(before, after).corrections).toBe(2);
  });

  it('counts a plain done flip once, for a mind row with no named steps', () => {
    const before = facts([day('2026-08-24', { mind: [mindRow({ done: false })] })]);
    const after = facts([day('2026-08-24', { mind: [mindRow({ done: true })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(1);
  });

  it('adds every kind of change together across a whole week', () => {
    const before = facts([
      day('2026-08-24', {
        sessions: [session({ occurrence_id: 's1', status: 'pending' })],
        meals: meals('2026-08-24'),
        mind: [mindRow({ occurrence_id: 'm1', done: false })],
      }),
      day('2026-08-25', { meals: meals('2026-08-25', { lunch: false }) }),
    ]);
    const after = facts([
      day('2026-08-24', {
        sessions: [session({ occurrence_id: 's1', status: 'done' })],
        meals: meals('2026-08-24', { breakfast: true }),
        mind: [mindRow({ occurrence_id: 'm1', done: true })],
      }),
      day('2026-08-25', { meals: meals('2026-08-25', { lunch: true }) }),
    ]);
    // session status (1) + breakfast flip (1) + mind done flip (1) + lunch flip (1) = 4
    expect(diffWeekReview(before, after).corrections).toBe(4);
  });

  /**
   * The design doc's own example: "5 of 5 sessions · 18 of 21 meals · 3 corrections" — 21 meals is
   * 3 slots × 7 days, which only holds because every day carries exactly 3 meal slots.
   */
  it("produces the design doc's own worked example shape", () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-08-${17 + i}`);
    const before = facts(
      dates.map((d) => day(d, { sessions: [session({ occurrence_id: `s-${d}`, status: 'pending' })] })),
    );
    const after = facts(
      dates.map((d, i) =>
        day(d, {
          sessions: [session({ occurrence_id: `s-${d}`, status: 'done' })],
          // 18 of 21 meals logged: leave exactly 3 slots (one per the first 3 days) unlogged.
          meals: meals(d, { breakfast: i >= 3, lunch: true, dinner: true }),
        }),
      ),
    );
    const result = diffWeekReview(before, after);
    expect(result.summary.sessions_done).toBe(7);
    expect(result.summary.sessions_total).toBe(7);
    expect(result.summary.meals_total).toBe(21);
    expect(result.summary.meals_logged).toBe(18);
  });

  it('does not count a row that only exists in "after" (nothing in "before" to compare against)', () => {
    const before = facts([day('2026-08-24')]);
    const after = facts([day('2026-08-24', { sessions: [session({ occurrence_id: 'brand-new', status: 'done' })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(0);
    expect(diffWeekReview(before, after).summary.sessions_total).toBe(1);
  });
});
