import { nudgeCopy } from '@cadence/shared';
import { listFreezeSaveCandidates } from '../../../repos/notify-candidates.ts';
import type { NotifyRequest } from '../dispatch.ts';
import type { RegisteredProducer } from '../tick.ts';
import { addDays, inMorningWindow, userToday } from './clock.ts';

/**
 * freeze_save — a freeze absorbed yesterday's miss, and the streak is intact.
 *
 * The ONLY streak notification Cadence has. There is no counterpart that warns, counts down, or
 * says a streak is at risk, and there never will be: a protected streak whose protection is
 * advertised in advance is just a deadline with extra steps. This one fires after the fact, says
 * the day off was earned, and ends on a number that went up.
 *
 * Never the same night. The producer only proposes inside the user's morning window, so a save
 * recorded at 23:00 waits until 7am — a buzz at midnight telling someone their rest day was fine
 * is the thing that makes it not fine.
 *
 * `target` is the SAVED DATE, so the ledger's unique key gives one notification per rescued day
 * however often the tick runs, and a second freeze later in the week gets its own.
 */
async function produce(now: Date): Promise<NotifyRequest[]> {
  const out: NotifyRequest[] = [];
  for (const row of await listFreezeSaveCandidates()) {
    if (!inMorningWindow(now, row.timezone)) continue;
    const today = userToday(now, row.timezone);
    const saved = row.streak_state?.last_saved_by_freeze;
    if (!today || !saved) continue;
    // Yesterday in THEIR zone. The query's three-day window is slack for timezones and a late
    // tick; this is the exact test, and it is why the window is not a `current_date - 1` in SQL.
    if (saved !== addDays(today, -1)) continue;

    // A "0 days, still counting" message is worse than silence: it announces a rescue of nothing.
    const streakDays = row.streak_state?.current ?? 0;
    if (streakDays <= 0) continue;

    out.push({
      userId: row.user_id,
      kind: 'freeze_save',
      target: saved,
      ...nudgeCopy({ kind: 'freeze_save', streakDays, savedDate: saved }),
    });
  }
  return out;
}

export const freezeSaveProducer: RegisteredProducer = { kind: 'freeze_save', produce };
