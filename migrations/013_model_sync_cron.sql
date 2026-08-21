-- 013 — schedule the provider model refresh from Postgres, not Vercel.
--
-- Model discovery existed only as an admin button and nobody pressed it: measured 2026-08-20, the
-- cached catalog held 66 models while the provider listed 73 — and the seven it was missing were
-- exactly the ones a model decision needed that day (kimi-k2.6, kimi-k3, grok-4.5, grok-4.6,
-- qwen3.6-27b). A stale list is worse than no list: it reads as authoritative while quietly
-- omitting the option you wanted. Running the sync recovered all seven.
--
-- Why here rather than vercel.json: Vercel's Hobby plan caps how many cron entries you get and how
-- often they may run, and this project is already spending that budget on the health tick. Postgres
-- has its own scheduler, so the schedule lives beside the data and costs nothing from that budget.
-- (Owner's call, 2026-08-20: "we can put the cron in supabase and trigger it via api call".)
--
-- The secret is NOT in this file. `pg_net` reads it from Vault at call time, so rotating it is a
-- Vault update and never a migration. Store it once with:
--   select vault.create_secret('<CRON_SECRET>', 'ai_admin_cron_secret', 'Bearer token for /api/cron/*');
-- and the base URL the same way, so a deploy target change is also not a migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Ask AI Admin to refresh every provider's model catalog. Fire-and-forget by design: pg_net returns
-- a request id immediately and the work happens in AI Admin, which owns the provider keys. Failures
-- surface in net._http_response and in AI Admin's own logs, not by blocking a database session.
create or replace function public.tick_model_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret text;
  v_base   text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ai_admin_cron_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'ai_admin_base_url';

  if v_secret is null or v_base is null then
    raise warning 'tick_model_sync: missing vault secret(s); nothing scheduled';
    return null;
  end if;

  select net.http_get(
           url     := v_base || '/_/backend/api/cron/tick/models',
           headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 120000
         )
    into v_id;

  return v_id;
end;
$$;

revoke all on function public.tick_model_sync() from public;

-- 04:17 UTC daily: off the hour, so it does not pile onto every other service's midnight tick, and
-- outside the owner's waking hours in America/Toronto. Daily is right for a catalog that changes a
-- few times a month — hourly would be noise and quota.
select cron.unschedule('model-sync-daily') where exists (select 1 from cron.job where jobname = 'model-sync-daily');
select cron.schedule('model-sync-daily', '17 4 * * *', $$select public.tick_model_sync();$$);
