import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { upsertOccurrences, type NewOccurrence } from '../repos/occurrences.ts';
import { expandRecurrence } from './scheduling.ts';

export const DEFAULT_HORIZON_DAYS = 14;

/**
 * Rolling-horizon materialization (the "living plan" foundation): ensure dated occurrences exist
 * for the user's active plan from today through today+`days`. Idempotent — `upsertOccurrences`
 * is `on conflict (activity_id, date) do nothing` — so calling it repeatedly (on every
 * coach-session open / daily-view load) just tops up newly-in-range days as time passes. A
 * 6-month or open-ended goal never needs a giant up-front dump; it rolls forward two weeks at a
 * time. Recurrences are anchored to the plan's `generated_at`, so INTERVAL patterns (every other
 * day / week) keep the same parity across every top-up. Returns the count materialized this call.
 */
export async function ensureHorizon(userId: string, days = DEFAULT_HORIZON_DAYS): Promise<number> {
  const plan = await getActivePlan(userId);
  if (!plan) return 0;

  const anchor = new Date(plan.generated_at).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  const activities = await listActivities(plan.plan_id);
  const occ: NewOccurrence[] = [];
  for (const a of activities) {
    const recurrence = a.schedule?.recurrence;
    if (!recurrence) continue;
    for (const date of expandRecurrence(recurrence, today, to, anchor)) {
      occ.push({ activity_id: a.activity_id, user_id: userId, date });
    }
  }
  await upsertOccurrences(occ);
  return occ.length;
}
