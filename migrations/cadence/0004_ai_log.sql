-- 0004_ai_log.sql
-- Durable log of behind-the-scenes AI calls (capture / coach / pack-select / pack-summarize)
-- so we can review exactly what each step received and returned, and track where issues occur.
-- This is the persistent counterpart to the in-memory dev X-ray trace.

create table if not exists cadence.ai_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references cadence.users(id) on delete cascade,
  kind        text not null,                 -- capture | coach | pack_select | pack_summarize
  session_id  text,
  input       jsonb,                         -- what we sent (window / message / intent+catalog)
  output      jsonb,                         -- what came back (raw + parsed)
  meta        jsonb,                         -- model, tokens, persisted counts, confidence, etc.
  created_at  timestamptz not null default now()
);

create index if not exists ai_log_user_idx on cadence.ai_log (user_id, created_at desc);
create index if not exists ai_log_kind_idx on cadence.ai_log (kind, created_at desc);
