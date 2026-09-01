import { describe, it, expect } from 'vitest';
import type { OccurrenceStatus, StreakDay } from '@cadence/shared';
import {
  rollingConsistency,
  planEngagementCounts,
  type ConsistencyOccurrence,
  type EngagementOccurrence,
  advanceStreak,
  classifyDay,
  computeStreakView,
  initialStreakState,
  SEED_FREEZES,
} from './metrics.ts';

function occ(date: string | Date, status: OccurrenceStatus = 'done'): ConsistencyOccurrence {
  return { date: date as string, status };
}

/** Fixed "today" — Wednesday 2026-07-15 UTC. */
const TODAY = new Date(Date.UTC(2026, 6, 15));

describe('rollingConsistency (brand: never resets to zero)', () => {
  it('counts distinct done days in the window (kept/window)', () => {
    const occurrences = [
      occ('2026-07-15'), // today
      occ('2026-07-14'),
      occ('2026-07-13'),
      occ('2026-07-12'),
      occ('2026-07-11'),
      occ('2026-07-10', 'missed'), // due, not done — still counts against the denominator
      occ('2026-07-09'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 6, window: 7 });
  });

  it('a missed day lowers the ratio — it never resets progress to zero', () => {
    // A full week on file: 4 of 7 done, 3 due-but-not-done (today included) — still 4 of 7, not 0.
    const beforeMiss = [
      occ('2026-07-15', 'pending'), // today — on the plan, nothing done yet
      occ('2026-07-14'),
      occ('2026-07-13'),
      occ('2026-07-12'),
      occ('2026-07-11'),
      occ('2026-07-10', 'missed'),
      occ('2026-07-09', 'missed'),
    ];
    expect(rollingConsistency(beforeMiss, TODAY, 7)).toEqual({ kept: 4, window: 7 });
    expect(rollingConsistency(beforeMiss, TODAY, 7).kept).toBeGreaterThan(0);
  });

  it('ignores pending/skipped/missed — only done days count', () => {
    const occurrences = [
      occ('2026-07-15', 'done'),
      occ('2026-07-14', 'pending'),
      occ('2026-07-13', 'skipped'),
      occ('2026-07-12', 'missed'),
      occ('2026-07-11', 'done'),
      occ('2026-07-10', 'missed'), // fills out the window so this stays a pure status test
      occ('2026-07-09', 'pending'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 2, window: 7 });
  });

  it('counts a day once even with multiple done occurrences that day', () => {
    const occurrences = [
      occ('2026-07-15'),
      occ('2026-07-15'), // second activity same day
      occ('2026-07-14'),
    ];
    // Only two distinct days had anything scheduled at all — the rest of the window is a genuine
    // gap here (see 'a day with no occurrence at all' below), so the denominator is 2, not 7.
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 2, window: 2 });
  });

  it('excludes done days outside the window', () => {
    const occurrences = [
      occ('2026-07-15'),
      occ('2026-07-14', 'missed'),
      occ('2026-07-13', 'missed'),
      occ('2026-07-12', 'missed'),
      occ('2026-07-11', 'missed'),
      occ('2026-07-10', 'missed'),
      occ('2026-07-09', 'missed'),
      occ('2026-07-08'), // 8 days ago — outside a 7-day window ending today
      occ('2026-07-01'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 1, window: 7 });
  });

  it('normalizes DB Date objects the same as ISO date strings', () => {
    // postgres `date` columns often arrive as JS Date at midnight UTC
    const asDates = [
      occ(new Date(Date.UTC(2026, 6, 15))),
      occ(new Date(Date.UTC(2026, 6, 14))),
      occ(new Date(Date.UTC(2026, 6, 13))),
    ];
    const asStrings = [occ('2026-07-15'), occ('2026-07-14'), occ('2026-07-13')];
    expect(rollingConsistency(asDates, TODAY, 7)).toEqual(rollingConsistency(asStrings, TODAY, 7));
    // Three distinct scheduled days on file, all done — the other four are gaps, not misses.
    expect(rollingConsistency(asDates, TODAY, 7)).toEqual({ kept: 3, window: 3 });
  });

  /** The all-empty edge (required case): nothing ever scheduled reads as 0 of 0, never 0 of 7 —
   *  the exact streak-shame BRAND.md forbids, and the open question DESIGN-check-in.md named. */
  it('reads as 0 of 0 — never 0 of 7 — when nothing was ever scheduled', () => {
    expect(rollingConsistency([], TODAY, 7)).toEqual({ kept: 0, window: 0 });
  });

  /** The other required case: a day with NO occurrence at all (nothing due, not "due and missed")
   *  leaves the denominator — this is what makes the ratio honest once the horizon stops rolling
   *  and days past it are gaps, not silent misses, and for a fresh user with no plan yet. */
  it('a day with no occurrence at all leaves the denominator — a gap is not a miss', () => {
    const occurrences = [occ('2026-07-15'), occ('2026-07-14', 'missed')];
    // Only 07-15 and 07-14 had anything scheduled; the other 5 days of the window are genuine
    // gaps (nothing materialized, nothing due) and must not count as five silent misses.
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 1, window: 2 });
  });

  it('honors a custom windowDays', () => {
    const occurrences = [occ('2026-07-15'), occ('2026-07-14'), occ('2026-07-13', 'missed'), occ('2026-07-10')];
    expect(rollingConsistency(occurrences, TODAY, 3)).toEqual({ kept: 2, window: 3 });
  });
});

function day(date: string, o: Partial<StreakDay> = {}): StreakDay {
  return { date, due: false, engaged: false, inEpisode: false, ...o };
}
/** N consecutive kept days starting 2026-07-01 (or `start`). */
function keptRun(n: number, start = '2026-07-01'): StreakDay[] {
  const startMs = new Date(start).getTime();
  return Array.from({ length: n }, (_, i) =>
    day(new Date(startMs + i * 86_400_000).toISOString().slice(0, 10), { due: true, engaged: true }),
  );
}

describe('classifyDay', () => {
  it('engaged is always kept — even with nothing due (a check-in on a rest day still counts)', () => {
    expect(classifyDay(day('2026-07-01', { engaged: true }))).toBe('kept');
    expect(classifyDay(day('2026-07-01', { due: true, engaged: true }))).toBe('kept');
  });
  it('due + not engaged + not shielded = slip', () => {
    expect(classifyDay(day('2026-07-01', { due: true }))).toBe('slip');
  });
  it('an episode shields a no-show from becoming a slip (neutral, not slip)', () => {
    expect(classifyDay(day('2026-07-01', { due: true, inEpisode: true }))).toBe('neutral');
  });
  it('nothing due and no engagement is a neutral rest day', () => {
    expect(classifyDay(day('2026-07-01'))).toBe('neutral');
  });
});

describe('advanceStreak (protected streak + freeze economy)', () => {
  it('seeds a brand-new state with one freeze', () => {
    expect(initialStreakState().freezes).toBe(SEED_FREEZES);
    expect(initialStreakState()).toMatchObject({ current: 0, longest: 0, freeze_credit: 0, last_evaluated: null });
  });

  it('kept days extend current + longest and advance last_evaluated', () => {
    const s = advanceStreak(initialStreakState(), keptRun(3));
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
    expect(s.last_evaluated).toBe('2026-07-03');
    expect(s.freeze_credit).toBe(3);
  });

  it('earns a freeze every 7 kept days, capped at 2', () => {
    const after7 = advanceStreak(initialStreakState(), keptRun(7));
    expect(after7.current).toBe(7);
    expect(after7.freezes).toBe(2); // seed 1 + 1 earned
    expect(after7.freeze_credit).toBe(0);

    // 14 kept days would earn a 2nd, but the cap holds it at 2 (the over-cap earning is forfeited).
    const after14 = advanceStreak(initialStreakState(), keptRun(14));
    expect(after14.current).toBe(14);
    expect(after14.freezes).toBe(2);
    expect(after14.freeze_credit).toBe(0);
  });

  it('a slip spends a freeze and the streak HOLDS (never resets for a covered slip)', () => {
    const built = advanceStreak(initialStreakState(), keptRun(3)); // current 3, freezes 1 (seed)
    const afterSlip = advanceStreak(built, [day('2026-07-04', { due: true })]);
    expect(afterSlip.current).toBe(3); // held, not reset
    expect(afterSlip.freezes).toBe(0);
    expect(afterSlip.last_saved_by_freeze).toBe('2026-07-04');
  });

  it('a slip with no freeze left resets current to 0 (and clears credit)', () => {
    const built = advanceStreak(initialStreakState(), keptRun(3));
    const noFreeze = advanceStreak(built, [day('2026-07-04', { due: true })]); // spends the seed
    const reset = advanceStreak(noFreeze, [day('2026-07-05', { due: true })]);
    expect(reset.freezes).toBe(0);
    expect(reset.current).toBe(0);
    expect(reset.freeze_credit).toBe(0);
  });

  it('neutral days keep the run alive without extending it', () => {
    const s = advanceStreak(initialStreakState(), [
      day('2026-07-01', { due: true, engaged: true }),
      day('2026-07-02', { due: true, engaged: true }),
      day('2026-07-03'), // rest day — neutral
      day('2026-07-04', { due: true, engaged: true }),
    ]);
    expect(s.current).toBe(3);
    expect(s.last_evaluated).toBe('2026-07-04');
  });

  it('an in-episode no-show does not spend a freeze (the episode shields it)', () => {
    const built = advanceStreak(initialStreakState(), keptRun(3)); // freezes 1
    const inEpisode = advanceStreak(built, [day('2026-07-04', { due: true, inEpisode: true })]);
    expect(inEpisode.freezes).toBe(1); // untouched
    expect(inEpisode.current).toBe(3); // held
  });

  it('is forward-only: advancing with no days is a no-op', () => {
    const built = advanceStreak(initialStreakState(), keptRun(4));
    expect(advanceStreak(built, [])).toEqual(built);
  });
});

describe('computeStreakView (today is provisional)', () => {
  const built = advanceStreak(initialStreakState(), keptRun(5)); // current 5

  it('a kept today extends the shown count by one', () => {
    const view = computeStreakView(built, day('2026-07-06', { due: true, engaged: true }));
    expect(view.current).toBe(6);
    expect(view.longest).toBe(6);
  });

  it('a due-but-not-yet-done today HOLDS — it is not a slip until the day ends', () => {
    const view = computeStreakView(built, day('2026-07-06', { due: true }));
    expect(view.current).toBe(5); // no reset, no extension
    expect(view.freezes).toBe(built.freezes);
  });

  it('savedByFreeze lights up only within ~2 days of the rescue', () => {
    const rescued = { ...built, last_saved_by_freeze: '2026-07-05' };
    expect(computeStreakView(rescued, day('2026-07-06')).savedByFreeze).toBe(true);
    expect(computeStreakView(rescued, day('2026-07-07')).savedByFreeze).toBe(true);
    expect(computeStreakView(rescued, day('2026-07-09')).savedByFreeze).toBe(false);
    expect(computeStreakView(built, day('2026-07-06')).savedByFreeze).toBe(false); // never rescued
  });
});

/**
 * planEngagementCounts — the ONE derivation behind both the missed-session tripwire
 * (situation.ts) and the re-plan's recent_activity (replan.ts). Before it was shared, replan
 * counted `status === 'missed'` literally (nothing ever writes that status, so the counter was
 * structurally zero) and counted system rows in done/scheduled, so a person who no-showed 12 of 14
 * sessions reached the planning model as done 2 / missed 0 / scheduled 14.
 */
describe('planEngagementCounts', () => {
  const eng = (date: string, kind: 'user' | 'system', status: OccurrenceStatus): EngagementOccurrence => ({
    date,
    kind,
    status,
  });

  it('counts a past-due pending USER session as missed', () => {
    const counts = planEngagementCounts([eng('2026-07-14', 'user', 'pending')], TODAY);
    expect(counts.missed).toBe(1);
    expect(counts.scheduled).toBe(1);
  });

  it('never counts a past-due pending SYSTEM row as missed — an untapped meal card is not a no-show', () => {
    const mealCards = ['2026-07-12', '2026-07-13', '2026-07-14'].map((d) => eng(d, 'system', 'pending'));
    const counts = planEngagementCounts(mealCards, TODAY);
    expect(counts.missed).toBe(0);
    // System rows are out of the plan-engagement account entirely: the food signal travels as
    // food_log, and counting it here inflated `scheduled` for every nutrition user.
    expect(counts.scheduled).toBe(0);
  });

  it("today's still-pending session is not a miss yet — it has until the day ends", () => {
    expect(planEngagementCounts([eng('2026-07-15', 'user', 'pending')], TODAY).missed).toBe(0);
  });

  it('a detour-shelved (paused) session is not a miss — it was taken off the board on purpose', () => {
    expect(planEngagementCounts([eng('2026-07-13', 'user', 'paused')], TODAY).missed).toBe(0);
  });

  it('keeps done and skipped to effortful work, and reads a real slump honestly', () => {
    const occurrences: EngagementOccurrence[] = [
      eng('2026-07-13', 'user', 'done'),
      eng('2026-07-14', 'user', 'skipped'),
      ...['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'].map((d) => eng(d, 'user', 'pending')),
      // The noise that used to drown all of it: four per-meal tasks a day, none tapped.
      ...['2026-07-08', '2026-07-09', '2026-07-10'].flatMap((d) => [0, 1, 2, 3].map(() => eng(d, 'system', 'pending'))),
      eng('2026-07-11', 'system', 'done'),
    ];
    expect(planEngagementCounts(occurrences, TODAY)).toEqual({ done: 1, skipped: 1, missed: 5, scheduled: 7 });
  });

  it('normalizes Date-valued rows the driver hands back', () => {
    const row = {
      date: new Date(Date.UTC(2026, 6, 14)) as unknown as string,
      kind: 'user' as const,
      status: 'pending' as OccurrenceStatus,
    };
    expect(planEngagementCounts([row], TODAY).missed).toBe(1);
  });
});
