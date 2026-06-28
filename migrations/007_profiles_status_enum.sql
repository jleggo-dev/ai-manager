-- Convert profiles.status from text+CHECK to a proper enum type.
-- Also approves the bootstrap admin user.

-- 1. Create the enum type
CREATE TYPE public.account_status AS ENUM ('pending', 'approved', 'suspended');

-- 2. Drop the old CHECK constraint (named or inline)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

-- 3. Drop the text default before changing the column type (Postgres cannot auto-cast it)
ALTER TABLE public.profiles
  ALTER COLUMN status DROP DEFAULT;

-- 4. Cast the existing text column to the new enum
ALTER TABLE public.profiles
  ALTER COLUMN status TYPE public.account_status
  USING status::public.account_status;

-- 5. Re-apply the default using the enum literal
ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'pending'::public.account_status;

-- 5. Approve the bootstrap admin
UPDATE public.profiles
SET
  status      = 'approved'::public.account_status,
  approved_at = now(),
  updated_at  = now()
WHERE email = 'jleggo@gmail.com';
