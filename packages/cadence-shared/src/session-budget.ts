/**
 * The two numbers a scheduled activity has, and how to get the second from the first.
 *
 * Owner ruling 2026-08-17: "If I'm going to do a 40 min run the run should be 40mins, regardless
 * of if I have to warm-up before or stretch after. If I'm pursuing a 20min meditation session, I
 * want the meditation session to be 20mins (not 15mins, because I need 5 mins to find a quiet
 * place). I still want to know how much time to budget in my schedule for all of the work needed
 * for an activity."
 *
 * So there are two, and until now the app stored only one:
 *
 *   effort_min  — the thing the person NAMED. "A 40 minute run" is 40 minutes of running. This is
 *                 what `ActivitySchedule.duration_min` means, and it is what the coach writes down,
 *                 because it is the number the person said out loud.
 *   total_min   — effort plus the work around it (warm-up, cool-down, settling in). What you block
 *                 out in a calendar.
 *
 * Before this, `duration_min` was implicitly the whole session and `prescribe-session` carved the
 * warm-up out of it, so a `duration_min: 40` run came back Warm-up 5 / Easy run 25 / Cool-down 5 —
 * the run the person asked for lost 15 of its 40 minutes to overhead they never mentioned, AND the
 * session under-filled its own budget by 5. Naming the effort fixes the first half; deriving the
 * budget here fixes the second.
 *
 * WHY DERIVE RATHER THAN STORE. Warm-up is a property of the KIND of work, not a fact about this
 * person's commitment — a sit needs no warm-up however long it runs, and every run needs one. A
 * stored second number would have to be authored (by a model that would invent it), kept in sync
 * through every resize, and backfilled onto rows that never had it. A pure function of (effort,
 * area) needs none of that and cannot drift out of step with the effort it pads.
 *
 * THIS IS AN ESTIMATE, AND ONLY FOR PLANNING. Once `prescribe-session` has actually written the
 * session, the honest total is the sum of its prescribed blocks — `deriveWalkthrough(session)
 * .total_min` in `walkthrough.ts` — and that is what the walkthrough shows. Use `sessionBudget`
 * for the commitment card, the lock preview, and anywhere a budget must be shown BEFORE a session
 * exists to be measured.
 */
import type { GoalArea } from './types/baseline.ts';

/** The two numbers, plus the gap between them, all in whole minutes. */
export interface SessionBudget {
  /** What the person named — minutes of the activity itself. */
  effort_min: number;
  /** Warm-up + cool-down + settling. Zero when the work needs none. */
  prep_min: number;
  /** What to block out: `effort_min + prep_min`. */
  total_min: number;
}

/**
 * Minutes of surrounding work by area, before the short-session cap below.
 *
 * `movement` is 10 because it is two things — roughly five minutes easing in and five easing out;
 * that is also what `prescribe-session` is told to add, so the estimate and the real session agree.
 * `mind` is the owner's own five minutes to find a quiet place. `practice` gets the same five to
 * set up (open the notebook, tune the instrument). `nourishment` is zero: logging a meal has no
 * warm-up, and neither does stepping on a scale.
 *
 * An activity with no area — system rows, check-ins, foundational habits — gets zero rather than a
 * guess. Inventing overhead for "weigh in" would make the budget less trustworthy, not more.
 */
const PREP_BY_AREA: Record<GoalArea, number> = {
  movement: 10,
  mind: 5,
  practice: 5,
  nourishment: 0,
};

/**
 * Work out both numbers from the effort the person named.
 *
 * The cap is what keeps short sessions honest: prep never exceeds half the effort, so a six-minute
 * breathing practice is budgeted at nine minutes rather than eleven. Without it, the overhead on a
 * brief sit would read as larger than the sit.
 *
 * Returns null when there is no duration to reason about — plenty of commitments legitimately
 * carry none ("walk the dog"), and callers should render nothing rather than a zero.
 */
export function sessionBudget(effortMin: number | undefined | null, area?: GoalArea | null): SessionBudget | null {
  if (typeof effortMin !== 'number' || !Number.isFinite(effortMin) || effortMin <= 0) return null;
  const effort = Math.round(effortMin);
  /**
   * `?? 0` covers an area this build does not know, not just a missing one. `area` is typed, but
   * it arrives from the database and from three flattened type copies, and the neighbouring field
   * on an activity is `category` ("cardio", "strength") — so a caller passing the wrong one is a
   * live possibility rather than a hypothetical. Indexing on an unknown key yields `undefined`,
   * and `Math.min(undefined, …)` is NaN, which would render as "allow NaN" on the card. Unknown
   * gets the same zero that absent gets, for the reason above: a guess is worse than nothing.
   */
  const base = (area ? PREP_BY_AREA[area] : 0) ?? 0;
  const prep = Math.min(base, Math.floor(effort / 2));
  return { effort_min: effort, prep_min: prep, total_min: effort + prep };
}

/**
 * The budget as a parenthetical for a commitment row — "(allow 50)" — or empty when there is
 * nothing extra to allow for.
 *
 * Deliberately short and deliberately silent in the common case: most commitments are their own
 * whole session, and a row that appended "(allow 20)" to a twenty-minute sit would be noise. The
 * word is "allow" rather than "total" because the person is being asked to set time aside, which
 * is the thing they said they wanted to know.
 */
export function budgetNote(budget: SessionBudget | null): string {
  if (!budget || budget.prep_min <= 0) return '';
  return `(allow ${budget.total_min})`;
}
