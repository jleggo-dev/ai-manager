import type { PendingPlanActivity } from '@cadence/shared';
import { firesOn } from './plan-density.ts';

const DAY_WORDS: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};
const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const words = (codes: readonly string[]): string => codes.map((c) => DAY_WORDS[c] ?? c).join(', ');

/**
 * An `add` that names something the plan already has is a QUESTION, not a rejection to route
 * around (owner, 2026-09-06: "if we're trying to add the same thing to the same day, ask
 * intent"). The old line said "pick a distinct name", which steered the coach to invent a twin
 * ("Weighted ruck/hike 2") rather than find out what the person meant — and there are exactly
 * two things they can mean: a change to the commitment they have, or a second one beside it.
 * The tool cannot tell which. So it reports the facts — what exists, on which days, by which
 * handle, and whether the add lands on the same day — and tells her to ask.
 *
 * Deterministic and prompt-free: this is the tool's own return text, not a job prompt.
 */
export function sameTitleIntent(
  title: string,
  existing: PendingPlanActivity,
  handle: string,
  /** The add's own RRULE byday list ("MO,WE"), or null when it named no readable days. */
  byday: string | null,
  onProposal: boolean,
): string {
  const has: string[] = WEEK.filter((c) => firesOn(existing.recurrence, c));
  const wants = byday ? byday.split(',') : [];
  const overlap = wants.filter((c) => has.includes(c));
  const where = has.length ? ` on ${words(has)}` : '';
  const redo = onProposal
    ? ` If the existing "${title}" is this card's own earlier add and it is the mistake you are fixing, do not add a twin beside it — call propose_plan_change again with start_over true and ONLY the corrected edits.`
    : '';
  if (overlap.length) {
    return (
      `"${title}" already names a commitment${where} (handle ${handle}), and this add lands on ${words(overlap)} too. ` +
      `NOTHING was added. Do not decide for them — ask whether they mean a SECOND "${title}" that day alongside the one they have, or a change to the existing one. ` +
      `A change is an edit on ${handle} (move, retime, resize, rework). A second one needs its own name, since two by the same name are unreadable in their week — add it again under the name they choose.${redo}`
    );
  }
  return (
    `"${title}" already names a commitment${where} (handle ${handle}). NOTHING was added. ` +
    `Ask whether they want that one MOVED${wants.length ? ` to ${words(wants)}` : ''} (move on ${handle}) or a second one alongside it. ` +
    `A second one needs its own name, since two by the same name are unreadable in their week — add it again under the name they choose.${redo}`
  );
}
