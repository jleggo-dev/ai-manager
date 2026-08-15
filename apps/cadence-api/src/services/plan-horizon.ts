import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { getUser } from '../repos/users.ts';
import { upsertOccurrences, type NewOccurrence } from '../repos/occurrences.ts';
import { expandRecurrence } from './scheduling.ts';
import { localMinutes } from './notify/policy.ts';

export const DEFAULT_HORIZON_DAYS = 14;

/** "06:30" → 390. Anything that isn't a clock time (a word like "morning", or nothing at all)
 *  returns null and is never treated as past — we only skip what we can actually place. */
export function minutesOfDay(timeOfDay: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Rolling-horizon materialization (the "living plan" foundation): ensure dated occurrences exist
 * for the user's active plan from today through today+`days`. Idempotent — `upsertOccurrences`
 * is `on conflict (activity_id, date) do nothing` — so calling it repeatedly (on every
 * coach-session open / daily-view load) just tops up newly-in-range days as time passes. A
 * 6-month or open-ended goal never needs a giant up-front dump; it rolls forward two weeks at a
 * time. Recurrences are anchored to the plan's `generated_at`, so INTERVAL patterns (every other
 * day / week) keep the same parity across every top-up. Returns the count materialized this call.
 *
 * **Never invents a task in the past.** A slot for TODAY whose time has already gone by is
 * skipped, and the reason shows up hardest on the day a plan is born: someone who finished
 * onboarding at 9am was handed a 6:30 meditation and a 6:30 long run they could not possibly
 * have done, which the app would then count as missed. Their first morning with a coach opened
 * with two failures it had invented itself.
 *
 * It only ever affects slots being created LATE — a day already materialized keeps everything it
 * had, because the upsert leaves existing rows alone. So "today's 6:30 run" still stands all day
 * for anyone whose horizon reached today before 6:30, which is everyone with a plan older than a
 * day. Skipped only when we would be writing it down after the moment has passed.
 *
 * An unknown timezone means we cannot say what time it is for them, so nothing is skipped: a task
 * they can still do is a much smaller harm than a task quietly missing from their day.
 */
export async function ensureHorizon(userId: string, days = DEFAULT_HORIZON_DAYS): Promise<number> {
  const plan = await getActivePlan(userId);
  if (!plan) return 0;

  const anchor = new Date(plan.generated_at).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  const activities = await listActivities(plan.plan_id);
  const nowMinutes = localMinutes(new Date(), (await getUser(userId))?.timezone);
  const occ: NewOccurrence[] = [];
  for (const a of activities) {
    const recurrence = a.schedule?.recurrence;
    if (!recurrence) continue;
    const startsAt = minutesOfDay(a.schedule?.time_of_day);
    for (const date of expandRecurrence(recurrence, today, to, anchor)) {
      if (date === today && nowMinutes != null && startsAt != null && startsAt < nowMinutes) continue;
      occ.push({ activity_id: a.activity_id, user_id: userId, date });
    }
  }
  await upsertOccurrences(occ);
  return occ.length;
}
