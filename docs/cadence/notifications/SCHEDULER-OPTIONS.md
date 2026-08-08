# Notification scheduling — options (open, 2026-08-07)

Nothing here is decided. The framework (migration 0026, `services/notify/*`,
`POST /internal/notifications/tick`) is scheduler-agnostic on purpose: whatever wakes it up only
has to make one authenticated HTTP POST.

## First, the thing that is easy to get backwards

**None of these deliver a notification.** GitHub Actions, Vercel Cron and pg_cron are all just a
*clock*. The API sends to APNs; APNs delivers to the phone. Changing the clock changes nothing
about delivery, cost-per-notification, or reliability of the last mile.

## The bigger question: does it need a server at all?

iOS **local notifications** (`UNUserNotificationCenter`, via `@capacitor/local-notifications`)
are scheduled on-device. No server, no APNs, no network, exactly on time, free.

The dividing line is **what the notification needs to know**:

| Notification | Local | Push |
|---|---|---|
| "Your run is at 7am" | ✅ the plan is already on the device | overkill |
| "Your plan changed" | ❌ device doesn't know | ✅ |
| "You've been away a week" | ❌ a device can't observe its own absence | ✅ |
| "Your weekly check-in is ready" | ❌ | ✅ |

Limits of local: it only knows what the app knew when it last ran, and iOS caps ~**64 pending**
local notifications per app — so you schedule a rolling window (≈2 weeks) and refresh on app open
and on any plan change.

**Recommendation: hybrid, local-first.** Plan-derived reminders — likely most of Cadence's volume
— go local: free, exact, offline. Push is reserved for what only the server knows. That makes the
scheduler question much smaller, because the tick then handles the rare cases rather than everyone's
daily reminders.

## Clock options, if/when a server tick is needed

| | Frequency | Cost | Caveats |
|---|---|---|---|
| **Vercel Cron (Hobby)** | **once/day**, 2 jobs max | included | Unusable for a tick. |
| **Vercel Cron (Pro)** | minute-level, 40 jobs | $20/user/mo | Best punctuality; only worth it if Pro is wanted anyway. |
| **GitHub Actions** | every 5 min | free | Already used for CI. Scheduled runs drift 5–15 min, can be dropped under load, and are disabled after 60 days of repo inactivity. Owner prefers to keep Actions for CI. |
| **Supabase pg_cron + pg_net** | minute-level | included in the plan you already pay for | Extensions available but **not enabled** on the project (`pg_cron` 1.6.4, `pg_net` 0.20.0). `supabase_vault` IS installed, so the shared secret needn't sit in plaintext. Worked example: `option-supabase-pg-cron.sql`. Adds outbound HTTP from the production DB. |

Not investigated: external free cron services (cron-job.org, Upstash QStash). They work, but add a
vendor that can see the shared secret — worth weighing against pg_cron, which adds none.

## Known scaling limits in the current send path

Neither matters at present scale; both are cheaper to fix than to discover late.

1. **`sendToToken` opens a new HTTP/2 connection per device token** (`services/push-apns.ts`).
   APNs is designed for one long-lived multiplexed connection. Fine for tens of users, wasteful at
   thousands.
2. **The tick is sequential**, with a per-user daily-cap query — O(users) round trips per pass.
   Batch the cap counts and fan out sends before this matters.

Local-first pushes the crossover for both a long way out, which is a further argument for it.
