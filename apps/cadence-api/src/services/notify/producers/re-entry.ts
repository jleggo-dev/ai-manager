import { nudgeCopy } from '@cadence/shared';
import { listReEntryCandidates } from '../../../repos/notify-candidates.ts';
import type { NotifyRequest } from '../dispatch.ts';
import type { RegisteredProducer } from '../tick.ts';
import { addDays, daysBetween, inMorningWindow, userToday } from './clock.ts';

/**
 * re_entry — nobody has logged anything for a few days.
 *
 * The ladder DECAYS: one honest line at day three, one softer line at day seven, then nothing,
 * ever, for this absence. That shape is the entire design, and it is the opposite of what every
 * retention playbook prescribes. Escalation assumes the person is failing to hear you. Someone
 * three weeks away has heard; the useful thing at that point is to stop, so that coming back costs
 * nothing and carries no accumulated debt of ignored messages.
 *
 * The upper bound is enforced in the QUERY (last-done between 3 and 9 days ago), not here, so
 * there is no code path — no replay, no manual tick, no clock skew — on which a third nudge can be
 * produced. An active detour excludes the user entirely: they already told us why they are away.
 *
 * `target` is the DATE the threshold was crossed. That reading is deliberate and worth stating:
 * it makes the ladder per-absence, so a user who goes quiet again next winter gets the same two
 * lines rather than permanent silence bought by one quiet week two years earlier. (The literal
 * alternative — targeting the number 3 or 7 — would be once per account, forever.)
 */
const THRESHOLD_DAYS = [3, 7] as const;

async function produce(now: Date): Promise<NotifyRequest[]> {
  const out: NotifyRequest[] = [];
  for (const row of await listReEntryCandidates()) {
    // Morning only. A "checking in" at 9pm reads as being watched; at 9am it reads as an offer.
    if (!inMorningWindow(now, row.timezone)) continue;
    const today = userToday(now, row.timezone);
    if (!today) continue;

    const gap = daysBetween(row.last_done, today);
    // Exactly on the rung, never between them: day 4, 5 and 6 are silence by design.
    const thresholdDay = THRESHOLD_DAYS.find((d) => d === gap);
    if (!thresholdDay) continue;

    out.push({
      userId: row.user_id,
      kind: 're_entry',
      target: addDays(row.last_done, thresholdDay),
      ...nudgeCopy({ kind: 're_entry', thresholdDay }),
    });
  }
  return out;
}

export const reEntryProducer: RegisteredProducer = { kind: 're_entry', produce };
