import { apnsConfigured, sendPushToUser } from './push-apns.ts';
import { claimNotificationSlot, settleNotification } from '../repos/notifications.ts';

/**
 * "It's ready" — the transactional ping for work the user was told they could walk away from.
 *
 * Deliberately not routed through `notify()`: that dispatcher enforces the nudge policy — opt-in
 * default, quiet hours, daily cap — which is right for ambient coaching and wrong here. This is
 * transactional. The person asked for something, the screen said they could leave, and a pipeline
 * that finishes at 9:05pm still has to reach them.
 *
 * What it DOES borrow is the ledger. This push failed silently for weeks in the only way that
 * matters — the owner kept reporting "I never got a notification" and there was nothing to look
 * at, because a direct `sendPushToUser` records nothing and its `.catch()` went to a console on a
 * reclaimed instance. Now every outcome lands in `cadence.notifications`, including "no devices
 * ever registered", which is what the data says has actually been happening.
 *
 * Awaited by every caller for the same reason as the coach reply (#195): a promise left running
 * past the handler is a promise this platform may never finish.
 *
 * Shared by first-lock ("your first week is ready", services/lock.ts) and the manual adjustment
 * ("your adjusted week is ready", services/replan.ts) — two flows, one minutes-long wait, and it
 * would be the same copy-paste twice over (API-01).
 *
 * `kind` + `target` are the idempotency key: claiming the slot first means a retried commit, or a
 * second synthesis of the same proposal, cannot double-ping.
 */
export async function sendPlanReadyPush(
  userId: string,
  kind: string,
  target: string,
  title: string,
  body: string,
): Promise<void> {
  const id = await claimNotificationSlot(userId, kind, target, title, body).catch(() => null);
  try {
    if (!apnsConfigured()) {
      if (id) await settleNotification(id, 'skipped', 'not_configured');
      return;
    }
    const results = await sendPushToUser(userId, title, body);
    const delivered = results.filter((r) => r.status === 200).length;
    if (!id) return;
    if (delivered > 0) return void (await settleNotification(id, 'sent', `${delivered}/${results.length} device(s)`));
    const why = results.map((r) => `${r.status}${r.reason ? ` ${r.reason}` : ''}`).join('; ') || 'no_devices';
    await settleNotification(id, 'failed', why.slice(0, 400));
  } catch (e) {
    // The work is done and stored. Nothing about telling them may ever undo that.
    console.warn(`[${kind}] ready-push failed (the work landed regardless):`, e);
    if (id) await settleNotification(id, 'failed', String(e).slice(0, 400)).catch(() => {});
  }
}
