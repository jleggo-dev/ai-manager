import { buildLocalNotifications, type SchedulableActivity } from '@cadence/shared';
import type { PlanActivity } from './api/plan.ts';
import { capabilities } from './capability/index.ts';

/**
 * Keep on-device local notifications in step with the committed plan.
 *
 * Called on every plan load, which is deliberately often: reminders that disagree with the plan
 * are worse than none — a phone buzzing for a session that was replanned away reads as the app
 * not listening, which is precisely the promise Cadence makes. `sync()` is a full replace, so
 * running it more than necessary is harmless.
 *
 * No-op on web (`reminders.isAvailable()` is false there) and whenever notification permission
 * has not been granted, so this is safe to call unconditionally.
 */

/** `PlanActivity` flattens the schedule; the shared builder takes the nested shape. */
function toSchedulableActivity(a: PlanActivity): SchedulableActivity {
  return {
    activity_id: a.activity_id,
    title: a.title,
    schedule: { recurrence: a.recurrence, time_of_day: a.time_of_day },
  };
}

export interface SyncResult {
  scheduled: number;
  reason?: 'unavailable' | 'not_permitted' | 'no_plan';
}

/**
 * Reconcile reminders to `activities`. Never throws: this runs alongside plan loading on app
 * start, and a notification problem must not stop the app rendering.
 *
 * Deliberately does NOT request permission — that prompt belongs to a moment the user initiated
 * (Settings), not to app start. Here we only act on a permission already granted.
 */
export async function syncPlanLocalNotifications(activities: PlanActivity[]): Promise<SyncResult> {
  try {
    if (!capabilities.localNotifications.isAvailable()) return { scheduled: 0, reason: 'unavailable' };

    // An empty plan still syncs: it CANCELS everything, which is the correct behaviour when a
    // plan is cleared or the user starts over. Returning early here would leave orphans firing.
    const specs = buildLocalNotifications(activities.map(toSchedulableActivity));
    const scheduled = await capabilities.localNotifications.sync(specs);

    // sync() returns 0 both for "nothing to schedule" and "permission not granted"; only the
    // latter is worth surfacing, so distinguish them rather than reporting a misleading reason.
    if (scheduled === 0 && specs.length > 0) return { scheduled: 0, reason: 'not_permitted' };
    return { scheduled };
  } catch (err) {
    console.warn('[reminders] sync failed (non-fatal):', err);
    return { scheduled: 0, reason: 'unavailable' };
  }
}
