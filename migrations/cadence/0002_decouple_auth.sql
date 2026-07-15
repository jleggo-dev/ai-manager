-- Decouple Cadence from Supabase Auth (no email auth yet).
-- cadence.users becomes the standalone identity table; all other tables FK to it
-- instead of auth.users. A dev user is seeded so we can build/test before real
-- auth lands. When real auth arrives, link cadence.users.id ↔ auth.users.id.

-- 1. cadence.users: drop the FK to auth.users, own its id, add email.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'cadence' and rel.relname = 'users' and con.contype = 'f'
  loop
    execute format('alter table cadence.users drop constraint %I;', c.conname);
  end loop;
end $$;
alter table cadence.users alter column id set default gen_random_uuid();
alter table cadence.users add column if not exists email text;

-- 2. Repoint every user_id FK from auth.users → cadence.users (drop by discovery,
--    so it works regardless of the auto-generated constraint name).
do $$
declare t text; c record;
begin
  foreach t in array array[
    'goals','equipment','plans','activities','occurrences',
    'nutrition_logs','recipes','meal_plans','episodes','conversations'
  ]
  loop
    for c in
      select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'cadence' and rel.relname = t and con.contype = 'f'
        and (select attname from pg_attribute
             where attrelid = con.conrelid and attnum = con.conkey[1]) = 'user_id'
    loop
      execute format('alter table cadence.%I drop constraint %I;', t, c.conname);
    end loop;
    execute format(
      'alter table cadence.%I add constraint %I foreign key (user_id) references cadence.users(id) on delete cascade;',
      t, t || '_user_id_fkey'
    );
  end loop;
end $$;

-- 3. Seed the dev user (fixed id so cadence-api can reference it via CADENCE_DEV_USER_ID).
insert into cadence.users (id, name, email)
values ('00000000-0000-4000-a000-000000000001', 'Matt', 'jleggo@gmail.com')
on conflict (id) do nothing;
