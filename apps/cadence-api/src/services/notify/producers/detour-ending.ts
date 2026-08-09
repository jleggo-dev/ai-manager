import { nudgeCopy } from '@cadence/shared';
import { listDetourEndingCandidates } from '../../../repos/notify-candidates.ts';
import type { NotifyRequest } from '../dispatch.ts';
import type { RegisteredProducer } from '../tick.ts';
import { addDays, userToday } from './clock.ts';

/**
 * detour_ending — the detour finishes tomorrow, and the user gets to choose what happens next.
 *
 * The notification exists because the alternative is a plan that resumes on its own. A detour that
 * simply expires teaches someone that the pause was on loan and that asking for more of it is a
 * concession; saying so a day early, with both options offered as equals, is what makes "the plan
 * bends instead of resetting" true rather than a slogan.
 *
 * A day's notice, not a week's: far enough ahead to answer without hurry, close enough that the
 * answer is about how they actually feel rather than a guess about how they will.
 *
 * `target` is the episode id, so extending a detour (which moves the end date) does not silence
 * the next one — the new ending is the same episode and keeps the same slot, which is correct:
 * one notice per detour, not one per date it was ever going to end on.
 */
async function produce(now: Date): Promise<NotifyRequest[]> {
  const out: NotifyRequest[] = [];
  for (const row of await listDetourEndingCandidates()) {
    const today = userToday(now, row.timezone);
    if (!today) continue; // unknown zone → we cannot say "tomorrow" truthfully
    if (row.end_date !== addDays(today, 1)) continue;

    out.push({
      userId: row.user_id,
      kind: 'detour_ending',
      target: row.episode_id,
      ...nudgeCopy({ kind: 'detour_ending', episodeId: row.episode_id }),
    });
  }
  return out;
}

export const detourEndingProducer: RegisteredProducer = { kind: 'detour_ending', produce };
