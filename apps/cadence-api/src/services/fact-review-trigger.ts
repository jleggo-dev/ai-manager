import { claimFactReviewWeek } from '../repos/recaps.ts';
import { emptyOutcome, runFactReview, type FactReviewOutcome } from './fact-review.ts';

/**
 * WHEN the weekly fact review runs — the one place that decides it (HARNESS-V3 C7).
 *
 * It rides the weekly check-in close: `POST /plan/week-review/recap` calls this right after the
 * week's recap is written, so the review needs no cron of its own (the cron landscape ruling
 * stands). Owner ruling R4 — weekly at the check-in close, or monthly — is NOT made yet; this is the
 * proposed weekly cadence. Changing it is FACT_REVIEW_MIN_DAYS_BETWEEN alone: 28 makes it monthly
 * (still at a check-in close, the first one at least 28 days after the last review).
 *
 * The guard is the recap week. The first confirm of a week claims it (0062's
 * `recaps.fact_reviewed_at`); a re-confirm or a double tap of the same week finds it claimed and
 * does nothing, and so does a second week confirmed within the gap (catching up two old weeks in
 * one sitting reviews once). A claimed week whose run then fails is not retried — the next
 * check-in runs it.
 *
 * Never throws: the person confirmed their week, and a failed review must not turn that into an
 * error. Every outcome is logged.
 */

/** Weekly (R4, proposed): a review at most once per check-in week, and never twice within five days. */
export const FACT_REVIEW_MIN_DAYS_BETWEEN = 5;

/** A recap week as the recaps repo returns it. Anything else is no week to claim. */
export const WEEK_START_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function maybeRunFactReview(
  userId: string,
  weekStart: string | null | undefined,
): Promise<FactReviewOutcome> {
  try {
    if (!weekStart || !WEEK_START_RE.test(weekStart)) return emptyOutcome('no_week');
    const claimed = await claimFactReviewWeek(userId, weekStart, FACT_REVIEW_MIN_DAYS_BETWEEN);
    if (!claimed) return emptyOutcome('already_reviewed');
    const outcome = await runFactReview(userId);
    console.log('[fact_review]', JSON.stringify({ userId, weekStart, ...outcome }));
    return outcome;
  } catch (e) {
    console.error('[fact_review]', userId, weekStart, e);
    return emptyOutcome('failed');
  }
}
