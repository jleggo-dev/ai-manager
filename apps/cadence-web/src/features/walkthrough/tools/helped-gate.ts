/**
 * The once-a-day gate on "Did that help?" (Design's Mind 2 redline: asked at most once a day
 * ACROSS ALL MIND SURFACES — a second flow the same day closes with the credit line alone).
 *
 * Why it exists: the question is self-report for the coaching arc, and its value comes from
 * being occasional. Asked after every flow it becomes furniture — people answer reflexively or
 * resent it, and the signal dies. Once a day keeps it a question.
 *
 * localStorage on purpose: this is UX cadence, not data. It needs no server round-trip, costs
 * nothing when storage is unavailable (private browsing → asks every time, the pre-gate
 * behaviour), and being per-device is acceptable for a politeness rule.
 */

const KEY = 'cadence.helpedAskedOn';

function today(): string {
  const d = new Date();
  // Local calendar day, not UTC — "once a day" means the user's day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** May a mind surface ask "did that help?" right now? */
export function mayAskHelped(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(KEY) !== today();
  } catch {
    return true;
  }
}

/** Record that it was asked (call when the question is SHOWN, not when it's answered — a person
 *  who skips it was still asked, and asking again the same day is the thing the rule forbids). */
export function markHelpedAsked(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(KEY, today());
  } catch {
    /* private browsing etc. — degrade to asking, never to crashing */
  }
}
