import { buildLocalNudges, DEFAULT_NUDGE_TIER } from '@cadence/shared';
import { getLocalNudgePlan, getNotificationPrefs } from './api.ts';
import { capabilities } from './capability/index.ts';
import { donateCoachIdentity } from './coach-identity.ts';

/**
 * Keep on-device notifications in step with the plan AND with the user's dial.
 *
 * Called on every plan load, which is deliberately often. Reminders that disagree with the plan are
 * worse than none — a phone buzzing for a session that was replanned away reads as the app not
 * having listened, which is precisely the promise Cadence makes. `sync()` is a full replace, so
 * running it more than necessary is harmless.
 *
 * The prefs are fetched here rather than passed in because they are what makes this correct: a
 * user who has turned the dial down must stop receiving the extra nudges from the next sync, and a
 * user who moved their quiet hours must have everything inside the new window disappear. Building
 * the set without them would schedule the full catalog and rely on something downstream to
 * suppress it — and nothing downstream runs, because the OS fires these, not us.
 *
 * No-op on web (`localNotifications.isAvailable()` is false there) and whenever permission has not
 * been granted, so this is safe to call unconditionally.
 */

export interface SyncResult {
  scheduled: number;
  reason?: 'unavailable' | 'not_permitted' | 'no_plan';
}

/**
 * Reconcile on-device notifications. Never throws: this runs alongside plan loading on app start,
 * and a notification problem must not stop the app rendering.
 *
 * Deliberately does NOT request permission — that prompt belongs to a moment the user initiated
 * (Settings), not to app start. Here we only act on a permission already granted.
 */
export async function syncPlanLocalNotifications(): Promise<SyncResult> {
  try {
    if (!capabilities.localNotifications.isAvailable()) return { scheduled: 0, reason: 'unavailable' };

    const [prefs, plan] = await Promise.all([getNotificationPrefs(), getLocalNudgePlan()]);
    if (!plan || !plan.today) {
      // Still sync: an empty set CANCELS everything, which is the correct behaviour when a plan is
      // cleared or the user starts over. Returning early would leave orphans firing forever.
      await capabilities.localNotifications.sync([]);
      return { scheduled: 0, reason: 'no_plan' };
    }

    const specs = buildLocalNudges({
      tier: prefs?.tier ?? DEFAULT_NUDGE_TIER,
      // Defaults matching the server's, so a failed prefs fetch schedules a QUIETER night rather
      // than an unbounded one: no prefs means the standard 21:00→07:00 window still applies.
      quietStartMin: prefs?.quietStartMin ?? 21 * 60,
      quietEndMin: prefs?.quietEndMin ?? 7 * 60,
      today: plan.today,
      todayWeekday: plan.todayWeekday,
      nowMinutes: plan.nowMinutes,
      activities: plan.activities,
      weeklyCheckin: plan.weeklyCheckin,
      flexibleToday: plan.flexibleToday,
      yesterday: plan.yesterday,
      waypoints: plan.waypoints,
    });

    // Register the long-press actions and donate the coach's portrait BEFORE scheduling. Order
    // matters for both: iOS matches a notification to the most recent donation, and a notification
    // whose category is not yet registered renders with no buttons at all. Both are silent no-ops
    // on web, without a chosen face, or when the native plugin is absent.
    await capabilities.coachIdentity.registerCategories();
    await donateCoachIdentity();

    const scheduled = await capabilities.localNotifications.sync(specs);
    if (scheduled === 0 && specs.length > 0) return { scheduled: 0, reason: 'not_permitted' };
    return { scheduled };
  } catch (err) {
    console.warn('[reminders] sync failed (non-fatal):', err);
    return { scheduled: 0, reason: 'unavailable' };
  }
}
