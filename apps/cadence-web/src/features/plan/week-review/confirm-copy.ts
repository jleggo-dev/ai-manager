import type { WeekReviewCorrectionsSummary } from './week-review-diff.ts';

/** "1 fix" / "2 fixes" — never the literal "fix(es)" the mockup shorthand notes. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface ConfirmCopy {
  label: string;
  helper: string;
}

/**
 * The footer button's label + helper line, straight from the approved mockup (verbatim, per the
 * check-in rebuild spec): silence reads as agreement, so a week with nothing corrected gets the
 * plain confirm; a week with corrections says how many, and that they're already saved — the
 * button FINALIZES the review, it does not re-write anything (every toggle already wrote through
 * `useWeekReview`'s own write-behind-the-optimistic-update).
 */
export function confirmCopy(corrections: number): ConfirmCopy {
  if (corrections === 0) {
    return { label: 'Confirm my week', helper: 'Nothing changed — confirms the week as logged.' };
  }
  return {
    label: `Confirm week · save ${corrections} ${plural(corrections, 'fix', 'fixes')}`,
    helper: `${corrections} ${plural(corrections, 'correction', 'corrections')} will be written to your log, then a summary goes to your coach.`,
  };
}

/**
 * The receipt handed to the coach, visibly, once "Confirm my week" is tapped (check-in rebuild,
 * step 5) — exactly "Week confirmed — {S} of {St} sessions · {M} of {Mt} meals · {C}
 * correction(s)". Read from the SAME summary the footer's own label counted from, so the number
 * she's told about and the number the user just saw agree by construction.
 */
export function confirmReceipt(summary: WeekReviewCorrectionsSummary): string {
  const { sessions_done, sessions_total, meals_logged, meals_total, corrections } = summary;
  const correctionWord = plural(corrections, 'correction', 'corrections');
  return (
    `Week confirmed — ${sessions_done} of ${sessions_total} sessions · ` +
    `${meals_logged} of ${meals_total} meals · ${corrections} ${correctionWord}`
  );
}
