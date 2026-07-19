-- Cadence — initial schema (spec §5, §B1, §B2, §C6)
-- Target: REUSES the Spartan Tracker Supabase project
--   (https://qvukqinwmyvewzgcsgzt.supabase.co) — Cadence supersedes Spartan Tracker.
-- All Cadence tables live in a dedicated `cadence` schema so the existing
-- public.tracker_data table is untouched and Spartan Tracker can be dropped later.
-- AI Admin owns AI profiles/jobs/workflows/chat-session state; Cadence owns app data.
--
-- Access model: cadence-api connects with the SERVICE ROLE and sets the schema to
-- `cadence` (see apps/cadence-api/src/db/supabase.ts → db.schema). The service role
-- BYPASSES RLS, so cadence-api MUST scope every query by user_id. The RLS policies
-- below are defense-in-depth for any future direct-PostgREST (JWT) access.

create schema if not exists cadence;

-- ── Users / baseline (§5.1) ────────────────────────────────────────────
create table if not exists cadence.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '',
  home_location jsonb,                       -- { lat, lon, label } — coarse, permission-gated (§B1)
  timezone      text,
  baseline      jsonb not null default '{}', -- age, height_cm, weight_kg, injuries[], constraints[], preferences{}
  steer_back    jsonb not null default '{"aggressivity":"balanced","missed_threshold":3}',
  macro_targets jsonb,                        -- { kcal, protein_g, carbs_g, fat_g, confirm_below_confidence } (§B2)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Goals (§5.2) ───────────────────────────────────────────────────────
create table if not exists cadence.goals (
  goal_id          uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  title            text not null,
  category         text not null check (category in ('fitness','nutrition','weight','habit')),
  type             text not null check (type in ('milestone','target','recurring')),
  measure          jsonb not null default '{}',
  timeframe        jsonb not null default '{}',
  status           text not null default 'captured'
                   check (status in ('captured','confirmed','locked','parked','completed','abandoned')),
  linked_equipment uuid[] not null default '{}',
  source           text not null default 'captured' check (source in ('captured','manual')),
  confidence       real,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists goals_user_status_idx on cadence.goals (user_id, status);

-- ── Equipment (§5.3) ───────────────────────────────────────────────────
create table if not exists cadence.equipment (
  equipment_id    uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  category        text not null check (category in ('footwear','cardio','strength','accessory','reading','other')),
  owned           boolean not null default true,
  recommended_by  text check (recommended_by in ('ai')),
  linked_goal_ids uuid[] not null default '{}',
  wear            jsonb,                       -- footwear only: accumulated_km, threshold_km, status, …
  created_at      timestamptz not null default now()
);
create index if not exists equipment_user_idx on cadence.equipment (user_id);

-- ── Plans & activities (§5.4) ──────────────────────────────────────────
create table if not exists cadence.plans (
  plan_id      uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  goal_ids     uuid[] not null default '{}',
  generated_by text not null default 'coach',
  version      int not null default 1,
  status       text not null default 'active' check (status in ('active','superseded','draft')),
  generated_at timestamptz not null default now()
);
create index if not exists plans_user_status_idx on cadence.plans (user_id, status);

create table if not exists cadence.activities (
  activity_id        uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references cadence.plans (plan_id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  goal_id            uuid references cadence.goals (goal_id) on delete set null,
  title              text not null,
  kind               text not null check (kind in ('user','system')),
  category           text,
  schedule           jsonb not null default '{}',
  target             jsonb,
  completion_source  text not null default 'self_report'
                     check (completion_source in ('self_report','healthkit','reply','auto')),
  how_to             text,
  disrupted_override jsonb
);
create index if not exists activities_plan_idx on cadence.activities (plan_id);

-- ── Occurrences / completion log (§5.5, + §B1 weather) ─────────────────
create table if not exists cadence.occurrences (
  occurrence_id uuid primary key default gen_random_uuid(),
  activity_id   uuid not null references cadence.activities (activity_id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  date          date not null,
  status        text not null default 'pending' check (status in ('pending','done','skipped','missed')),
  value         jsonb,                         -- { distance_km, avg_hr, … }
  provenance    jsonb,                         -- { source, auto, recorded_at } — drives "via Apple Health" badge
  weather       jsonb                          -- outdoor activities only (§B1)
);
create index if not exists occurrences_user_date_idx on cadence.occurrences (user_id, date);
create unique index if not exists occurrences_activity_date_idx on cadence.occurrences (activity_id, date);

-- ── Nutrition (§5.6, §B2) ──────────────────────────────────────────────
create table if not exists cadence.nutrition_logs (
  log_id        uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  date          date not null,
  meal          text not null check (meal in ('breakfast','lunch','dinner','snack')),
  items         jsonb not null default '[]',
  macros        jsonb not null default '{}',
  input_method  text not null check (input_method in ('photo','voice','text','manual')),
  ai_confidence real,
  provisional   boolean not null default false, -- below confirm threshold → excluded from totals
  photo_ref     text,
  created_at    timestamptz not null default now()
);
create index if not exists nutrition_user_date_idx on cadence.nutrition_logs (user_id, date);

create table if not exists cadence.recipes (
  recipe_id          uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null,
  source             text not null check (source in ('user','ai','ai_from_fridge_photo')),
  servings           int,
  ingredients        jsonb not null default '[]',
  steps              jsonb not null default '[]',
  macros_per_serving jsonb,
  tags               text[] not null default '{}',
  saved              boolean not null default false,
  created_at         timestamptz not null default now()
);

create table if not exists cadence.meal_plans (
  meal_plan_id  uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  week_of       date not null,
  days          jsonb not null default '[]',
  shopping_list jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

-- ── Disrupted episodes (§5.7) ──────────────────────────────────────────
-- Additive temporary overlay (not a plan rewrite): protects the streak, makes space
-- to "do what you can", base plan resumes on end. available_equipment is confirmed
-- per-episode (e.g. parsed from a hotel-gym photo).
create table if not exists cadence.episodes (
  episode_id          uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  type                text not null check (type in ('travel','illness','injury','recovery','custom')),
  start_date          date not null,
  end_date            date not null,
  available_equipment jsonb not null default '[]',
  constraints         jsonb not null default '{}',
  temp_activities     jsonb not null default '[]',
  overrides           jsonb not null default '[]',
  protect_streak      boolean not null default true,
  tone                text check (tone in ('gentle','supportive')),
  status              text not null default 'active' check (status in ('active','ended')),
  created_at          timestamptz not null default now()
);
create index if not exists episodes_user_status_idx on cadence.episodes (user_id, status);

-- ── Conversation mapping (§C6) ─────────────────────────────────────────
-- Cadence conversation_id ↔ AI Admin chat-session id / provider externalChatId.
create table if not exists cadence.conversations (
  conversation_id  uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  ai_session_id    text not null,              -- AI Admin chat-session id
  external_chat_id text,                        -- provider chat id (Devs.ai)
  rolling_summary  text,                        -- Broker-written summary of older turns (§4.3)
  token_estimate   int not null default 0,      -- drives green/amber/red budget tiers
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists conversations_user_idx on cadence.conversations (user_id);
create unique index if not exists conversations_ai_session_idx on cadence.conversations (ai_session_id);

-- ── Row-level security (defense-in-depth; service role bypasses it) ─────
-- cadence.users keys on `id`; every other table keys on `user_id`.
alter table cadence.users enable row level security;
create policy users_owner on cadence.users
  using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'goals','equipment','plans','activities','occurrences',
    'nutrition_logs','recipes','meal_plans','episodes','conversations'
  ]
  loop
    execute format('alter table cadence.%I enable row level security;', t);
    execute format(
      'create policy %1$s_owner on cadence.%1$I using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;
