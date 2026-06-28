-- Account approval profiles keyed to auth.users
-- Apply in Supabase SQL Editor or via migration tooling.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles (status);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

COMMENT ON TABLE public.profiles IS 'App account status for Supabase auth users; new signups start pending until admin approval.';

-- Auto-create profile on signup (email/password or OAuth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'display_name',
    trim(both ' ' from concat(
      coalesce(NEW.raw_user_meta_data->>'given_name', ''),
      ' ',
      coalesce(NEW.raw_user_meta_data->>'family_name', '')
    )),
    ''
  );
  IF v_display_name = '' THEN
    v_display_name := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, status)
  VALUES (NEW.id, NEW.email, v_display_name, 'pending')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing users as approved so current deployments keep working
INSERT INTO public.profiles (id, email, display_name, status, created_at, updated_at)
SELECT
  u.id,
  u.email,
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'display_name',
    NULL
  ),
  'approved',
  COALESCE(u.created_at, now()),
  now()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Writes are service-role only (backend admin endpoints)
