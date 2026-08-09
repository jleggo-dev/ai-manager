import { isNudgeTier } from '@cadence/shared';
import { sql, json } from '../db/sql.ts';
import { DEFAULT_PREFS, type NotificationPrefs, type SkipReason } from '../services/notify/policy.ts';

/** Prefs + delivery ledger (migrations 0026, 0028). */

/** Read prefs, falling back to defaults when the user has no row yet — no backfill needed. */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await sql<
    {
      enabled: boolean;
      tier: string | null;
      quiet_start_min: number;
      quiet_end_min: number;
      kinds: unknown;
      max_per_day: number;
    }[]
  >`select enabled, tier, quiet_start_min, quiet_end_min, kinds, max_per_day
      from cadence.notification_prefs where user_id = ${userId}`;
  const r = rows[0];
  if (!r) return { ...DEFAULT_PREFS };
  return {
    enabled: r.enabled,
    // Re-validated on the way out, not trusted from the column. The check constraint is the
    // guarantee, but a pre-0028 row read by a post-0028 deploy has no tier at all, and falling
    // back to the default beats handing `null` to a comparison that would then allow nothing.
    tier: isNudgeTier(r.tier) ? r.tier : DEFAULT_PREFS.tier,
    quietStartMin: r.quiet_start_min,
    quietEndMin: r.quiet_end_min,
    kinds: (r.kinds ?? {}) as Record<string, boolean>,
    maxPerDay: r.max_per_day,
  };
}

export async function upsertNotificationPrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<void> {
  const cur = await getNotificationPrefs(userId);
  const next = { ...cur, ...patch };
  await sql`
    insert into cadence.notification_prefs
      (user_id, enabled, tier, quiet_start_min, quiet_end_min, kinds, max_per_day)
    values (${userId}, ${next.enabled}, ${next.tier}, ${next.quietStartMin}, ${next.quietEndMin},
            ${json(next.kinds)}, ${next.maxPerDay})
    on conflict (user_id) do update set
      enabled = excluded.enabled,
      tier = excluded.tier,
      quiet_start_min = excluded.quiet_start_min,
      quiet_end_min = excluded.quiet_end_min,
      kinds = excluded.kinds,
      max_per_day = excluded.max_per_day,
      updated_at = now()`;
}

/**
 * CLAIM the idempotency slot for (user, kind, target) before doing anything else.
 *
 * Insert-first is the whole design. The alternative — check, send, then record — has a window
 * where two overlapping ticks both see "not sent" and both buzz the phone. Here the unique
 * index arbitrates: the loser gets 0 rows back and stops. A push is unrecallable, so the race
 * has to be lost safely rather than handled optimistically.
 *
 * Returns the new row's id, or null when the slot is already taken.
 */
export async function claimNotificationSlot(
  userId: string,
  kind: string,
  target: string,
  title: string,
  body: string,
): Promise<string | null> {
  const rows = await sql<{ notification_id: string }[]>`
    insert into cadence.notifications (user_id, kind, target, title, body, status)
    values (${userId}, ${kind}, ${target}, ${title}, ${body}, 'skipped')
    on conflict (user_id, kind, target) do nothing
    returning notification_id`;
  return rows[0]?.notification_id ?? null;
}

/** Settle a claimed slot once the outcome is known. */
export async function settleNotification(
  notificationId: string,
  status: 'sent' | 'failed' | 'skipped',
  detail?: string | SkipReason,
): Promise<void> {
  await sql`
    update cadence.notifications
       set status = ${status}, detail = ${detail ?? null}
     where notification_id = ${notificationId}`;
}

/**
 * How many notifications were SENT to this user on their local calendar day.
 *
 * Counts only 'sent': a skip is not a delivery, and counting skips toward the cap would let a
 * quiet-hours night silently consume the next day's budget. The local-day boundary is passed in
 * as an explicit UTC range because only the caller knows the user's timezone.
 */
export async function countSentBetween(userId: string, fromIso: string, toIso: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int n from cadence.notifications
     where user_id = ${userId} and status = 'sent'
       and created_at >= ${fromIso} and created_at < ${toIso}`;
  return rows[0]?.n ?? 0;
}

export interface NotificationRow {
  notification_id: string;
  kind: string;
  target: string;
  title: string;
  body: string;
  status: string;
  detail: string | null;
  created_at: string;
}

/** Recent deliveries for a user — powers "why didn't I get it?" without a DB console. */
export async function recentNotifications(userId: string, limit = 30): Promise<NotificationRow[]> {
  return (await sql`
    select notification_id, kind, target, title, body, status, detail, created_at
      from cadence.notifications where user_id = ${userId}
     order by created_at desc limit ${limit}`) as unknown as NotificationRow[];
}
