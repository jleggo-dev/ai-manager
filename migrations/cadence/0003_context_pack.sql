-- 0003_context_pack.sql
-- P1 of the context/memory architecture (docs/cadence/MEMORY-ARCHITECTURE.md).
-- The Broker-/registry-built working-memory block per user, with provenance + TTL.

create table if not exists cadence.context_pack (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references cadence.users(id) on delete cascade,
  topic          text,                            -- null = global; else nutrition/training/...
  sections       jsonb not null default '{}'::jsonb,   -- {fnName: rendered section}
  rendered       text not null,                   -- the end-of-prefix context block
  provenance     jsonb not null default '[]'::jsonb,   -- [{fn, params, rows, at}]
  token_estimate int,
  built_at       timestamptz not null default now(),
  expires_at     timestamptz not null,
  version        int not null default 1,
  status         text not null default 'fresh'    -- fresh | enriching | stale
);

create index if not exists context_pack_user_topic_idx
  on cadence.context_pack (user_id, topic, built_at desc);
