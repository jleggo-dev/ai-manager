import { nudgeCopy } from '@cadence/shared';
import { listCheckinDueCandidates } from '../../../repos/notify-candidates.ts';
import type { NotifyRequest } from '../dispatch.ts';
import type { RegisteredProducer } from '../tick.ts';
import { addDays, inMorningWindow } from './clock.ts';

/**
 * weekly_checkin (push) — the active plan's week has run out, and nobody has said so.
 *
 * `computeWeekState` (plan-view.ts) already names this exact fact for the in-app "check in"
 * affordance: `checkin_due` flips true at `generated_at + horizon_days` (the plan's own week
 * length, 0049 — 7 unless the coach granted an extension). This producer reads the SAME fact the
 * SAME way (see the candidate query's own comment for the bound), so the push and the screen can
 * never quietly disagree about which day it started being true.
 *
 * `target` is the date the week ran out — `generated_at` (a plan column that does not move while
 * the plan stays active) plus its horizon. That is the whole mechanism behind the brand requirement that a
 * check-in can never be a thing you are late for (DESIGN-check-in.md): an ignored check-in is not
 * acted on, so nothing supersedes the active plan, so `generated_at` — and therefore `target` —
 * is unchanged on every tick that follows. `notify()`'s dedupe key is (user, kind, target), so the
 * first tick that succeeds in sending claims that target for good; every later tick for the same
 * stalled week finds the slot already spent and reports 'duplicate', silently. There is no ladder
 * to climb and no count to escalate, because there is only ever one target for one week — it falls
 * straight out of the dedupe key rather than needing a guard of its own.
 *
 * No upper bound on the query, unlike `re_entry`'s day-9 ceiling: there is nothing here to decay
 * away from. Whichever way the plan finally moves — a check-in that ends in a rebuild, or "just
 * build my week — I trust you" — a new active plan with a new `generated_at` starts the whole
 * thing over for the following week.
 *
 * Proposed only in the user's morning window, same reasoning as `freeze_save` and `re_entry`: the
 * FIRST tick to see a candidate is the only one that gets to decide (dispatch.ts claims the slot
 * before it checks quiet hours, so a claim spent inside them is spent for good — there is no second
 * attempt at the same target). Gating here is what keeps kinds.ts's own label for this nudge —
 * "the morning it lands" — actually true, and keeps that first, only attempt away from the one
 * window it could otherwise be silently lost in.
 */
async function produce(now: Date): Promise<NotifyRequest[]> {
  const out: NotifyRequest[] = [];
  for (const row of await listCheckinDueCandidates()) {
    if (!inMorningWindow(now, row.timezone)) continue;

    out.push({
      userId: row.user_id,
      kind: 'weekly_checkin',
      target: addDays(row.generated_at, row.horizon_days),
      ...nudgeCopy({ kind: 'weekly_checkin' }),
    });
  }
  return out;
}

export const checkinDueProducer: RegisteredProducer = { kind: 'weekly_checkin', produce };
