/**
 * The client twin of `apps/cadence-api/src/services/week-review-diff.test.ts` — same cases, same
 * expectations, ported rather than shared (see `week-review-diff.ts`'s own doc). If a case here
 * ever disagrees with the server's, the two counting rules have drifted and one of them is wrong.
 */
import { describe, expect, it } from 'vitest';
import { diffWeekReview } from './week-review-diff.ts';
import type {
  WeekReviewDay,
  WeekReviewFacts,
  WeekReviewMealSlot,
  WeekReviewMindRow,
  WeekReviewSessionRow,
} from '../../../lib/api.ts';

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

describe('diffWeekReview (client)', () => {
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

  it('counts a status flip AND a minutes edit on the same row as two corrections', () => {
    const before = facts([day('2026-08-24', { sessions: [session({ status: 'pending', logged_min: undefined })] })]);
    const after = facts([day('2026-08-24', { sessions: [session({ status: 'done', logged_min: 45 })] })]);
    expect(diffWeekReview(before, after).corrections).toBe(2);
  });

  it('counts a meal flip once, keyed by (date, meal) even when the id only appears in "after"', () => {
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
    expect(diffWeekReview(before, after).corrections).toBe(4);
  });

  /** The receipt's own worked shape: "5 of 5 sessions · 18 of 21 meals · 3 corrections" needs
   *  21 meals — 3 slots × 7 days — which only holds because every day carries exactly 3 slots. */
  it("produces the receipt's own worked example shape", () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-08-${17 + i}`);
    const before = facts(
      dates.map((d) => day(d, { sessions: [session({ occurrence_id: `s-${d}`, status: 'pending' })] })),
    );
    const after = facts(
      dates.map((d, i) =>
        day(d, {
          sessions: [session({ occurrence_id: `s-${d}`, status: 'done' })],
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

  it('ignores the weigh-in row entirely — it is status-only, never a counted correction', () => {
    const before: WeekReviewFacts = {
      ...facts([day('2026-08-24')]),
      weigh_in: { occurrence_id: 'w1', date: '2026-08-24', status: 'pending' },
    };
    const after: WeekReviewFacts = { ...before, weigh_in: { ...before.weigh_in!, status: 'done' } };
    expect(diffWeekReview(before, after).corrections).toBe(0);
  });
});
