/**
 * The single way a notification is ever sent.
 *
 * Everything funnels through `notify()` so the guarantees live in ONE place: idempotency, quiet
 * hours, the daily cap, and a ledger row for every outcome including the ones we chose not to
 * send. A caller that reached for `sendPushToUser` directly would bypass all four, so the send
 * path is deliberately not re-exported here.
 *
 * Order is: claim the slot, THEN decide, THEN send. Claiming first is what makes concurrent or
 * retried ticks safe — see `claimNotificationSlot`. Deciding before sending means a skip still
 * occupies the slot, so a tick running every 15 minutes does not re-evaluate the same candidate
 * all day and then fire the instant quiet hours lift.
 */
import { categoryForKind, isNudgeKind } from '@cadence/shared';
import { apnsConfigured, sendPushToUser } from '../push-apns.ts';
import { listDeviceTokens } from '../../repos/device-tokens.ts';
import { getUser } from '../../repos/users.ts';
import {
  claimNotificationSlot,
  countSentBetween,
  getNotificationPrefs,
  settleNotification,
} from '../../repos/notifications.ts';
import { decide, localMinutes, type SkipReason } from './policy.ts';

export interface NotifyRequest {
  userId: string;
  /** Groups notifications for per-kind muting, e.g. 'session_reminder'. */
  kind: string;
  /** What this is ABOUT — an ISO date, an occurrence id. With (userId, kind) it is the dedupe key. */
  target: string;
  title: string;
  body: string;
  /** Payload the app reads when an action button is tapped. Composed by the producer, at send
   *  time — never worked out when the notification is acted on. */
  extra?: Record<string, unknown>;
}

export type NotifyStatus = 'sent' | 'failed' | 'skipped' | 'duplicate';

export interface NotifyOutcome {
  status: NotifyStatus;
  reason?: SkipReason | string;
}

/**
 * UTC bounds of the user's LOCAL calendar day, for counting against the daily cap.
 *
 * Derived by walking back from `now` by its own local minutes-past-midnight. On the one or two
 * days a year a DST shift lands inside the window this is off by an hour, which is accepted: the
 * cap is a soft guard against a scheduler bug, not an accounting boundary, and the alternative
 * (resolving a zoned midnight exactly) is a lot of machinery for an hour's drift twice a year.
 */
export function localDayRangeUtc(
  now: Date,
  timezone: string | null | undefined,
): { fromIso: string; toIso: string } | null {
  const mins = localMinutes(now, timezone);
  if (mins == null) return null;
  const from = new Date(now.getTime() - mins * 60_000);
  return { fromIso: from.toISOString(), toIso: new Date(from.getTime() + 24 * 3600_000).toISOString() };
}

/**
 * Attempt one notification. Never throws for an expected outcome — a caller looping over users
 * must not have the whole tick die because one person's device token went stale.
 */
export async function notify(req: NotifyRequest, now: Date = new Date()): Promise<NotifyOutcome> {
  const { userId, kind, target, title, body } = req;

  // 1. Claim. Losing here means someone else owns this (user, kind, target) — say so and stop.
  const id = await claimNotificationSlot(userId, kind, target, title, body);
  if (!id) return { status: 'duplicate' };

  try {
    const [prefs, user, tokens] = await Promise.all([
      getNotificationPrefs(userId),
      getUser(userId),
      listDeviceTokens(userId),
    ]);
    const range = localDayRangeUtc(now, user?.timezone);
    const sentToday = range ? await countSentBetween(userId, range.fromIso, range.toIso) : 0;

    // 2. Decide.
    const verdict = decide({
      prefs,
      kind,
      timezone: user?.timezone,
      sentToday,
      deviceCount: tokens.length,
      apnsConfigured: apnsConfigured(),
      now,
    });
    if (!verdict.send) {
      await settleNotification(id, 'skipped', verdict.reason);
      return { status: 'skipped', reason: verdict.reason };
    }

    // 3. Send. Per-token results; a user can have several devices and partial success is normal.
    // The category is derived from the kind rather than passed in, so a nudge cannot ship with the
    // wrong button set — or with none, which is the failure a caller would never notice.
    const categoryId = isNudgeKind(kind) ? categoryForKind(kind) : null;
    const results = await sendPushToUser(userId, title, body, {
      ...(categoryId ? { categoryId } : {}),
      ...(req.extra ? { extra: req.extra } : {}),
    });
    const delivered = results.filter((r) => r.status === 200).length;
    if (delivered > 0) {
      await settleNotification(id, 'sent', `${delivered}/${results.length} device(s)`);
      return { status: 'sent' };
    }
    const why = results.map((r) => `${r.status}${r.reason ? ` ${r.reason}` : ''}`).join('; ') || 'no devices';
    await settleNotification(id, 'failed', why.slice(0, 400));
    return { status: 'failed', reason: why };
  } catch (err) {
    // The slot stays claimed on purpose. Retrying an ambiguous failure risks a double buzz, and
    // a missed notification is far cheaper than a duplicate one.
    const message = err instanceof Error ? err.message : String(err);
    await settleNotification(id, 'failed', message.slice(0, 400)).catch(() => {});
    console.error('[notify]', kind, target, message);
    return { status: 'failed', reason: message };
  }
}
