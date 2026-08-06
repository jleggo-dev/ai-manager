-- 0023_device_tokens.sql
-- Native-shell push (iOS milestone): one row per registered device token. The Capacitor shell
-- registers with APNs on the user's say-so and POSTs the token here; the APNs sender reads a
-- user's rows to reach their devices. Tokens rotate at Apple's whim, so `token` is the natural
-- key (upsert re-parents a reused token to whoever is signed in) and stale rows are pruned when
-- APNs answers 410 Unregistered.

create table if not exists cadence.device_tokens (
  token        text primary key,
  user_id      uuid not null references cadence.users(id) on delete cascade,
  platform     text not null default 'ios' check (platform in ('ios')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on cadence.device_tokens (user_id);
