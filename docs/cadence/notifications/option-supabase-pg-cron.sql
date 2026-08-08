-- OPTION (not adopted, not applied) — schedule the notification tick from Postgres.
--
-- Deliberately NOT in migrations/: the scheduler is still an open choice. This is a worked
-- example so the option can be judged on real SQL rather than a description.
--
-- NOT auto-applied: this enables two extensions and creates a recurring job that makes outbound
-- HTTP calls from your production database. Read it, then run it deliberately.
--
-- WHY HERE RATHER THAN VERCEL OR GITHUB ACTIONS
--   Vercel Hobby caps cron at 2 jobs, ONCE PER DAY — unusable for a tick. (Pro lifts this to 40
--   jobs at minute granularity, so if you are on Pro, Vercel cron is also a fine choice.)
--   GitHub Actions allows every 5 minutes but scheduled runs commonly drift 5-15 minutes, can be
--   dropped under load, and are disabled after 60 days of repo inactivity.
--   pg_cron runs inside infrastructure you already pay for, at minute granularity, with none of
--   those caveats. Nothing here delivers a notification — APNs does that. This is only the clock.
--
-- SETUP (once, before running the schedule block below):
--   1. Enable the extensions (Dashboard → Database → Extensions, or the statements below).
--   2. Store the shared secret in Vault so it is never inline in a job definition:
--        select vault.create_secret('<CADENCE_CRON_SECRET>', 'cadence_cron_secret');
--      Re-run with vault.update_secret(...) if the secret is rotated.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The tick is idempotent by construction — every candidate is deduped on
-- (user_id, kind, target) — so a double-fire, a retry, or an overlap with a slow previous run
-- cannot double-send. That is what makes a short interval safe.
--
-- Every 15 minutes is a deliberate floor, not a maximum: quiet hours and the daily cap are
-- evaluated per user inside the API, so the tick only needs to be frequent enough that a
-- send lands near its intended local time. Finer than this buys nothing and costs invocations.
select cron.schedule(
  'cadence-notifications-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://ai-manager-cadence-api-2f4j.vercel.app/internal/notifications/tick',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'cadence_cron_secret')
    ),
    body    := '{}'::jsonb,
    -- Generous: the tick loops users and talks to APNs. pg_net is async, so a slow tick does not
    -- block the database — this only bounds how long the response is awaited.
    timeout_milliseconds := 30000
  );
  $$
);

-- Useful afterwards:
--   select * from cron.job;                                        -- is it scheduled?
--   select * from cron.job_run_details order by start_time desc limit 20;  -- did it run?
--   select * from net._http_response order by created desc limit 20;      -- what did the API say?
--   select cron.unschedule('cadence-notifications-tick');          -- turn it off
