-- Supabase-specific setup that Prisma can't express:
--   1. profiles.id -> auth.users.id foreign key
--   2. trigger that creates a profile for every new auth user
--   3. Row Level Security on every table in the public schema
--
-- Prisma connects as the table owner and bypasses RLS; API routes enforce access
-- themselves. RLS protects data reached with the anon key via the Supabase client
-- (PostgREST). Policies are read-only on purpose: all writes go through /api/v1.

-- 1. Link profiles to Supabase Auth -----------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- 2. Auto-create a profile on sign-up ---------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Row Level Security ------------------------------------------------------
-- Enable on everything; tables without a policy are server-only (deny all).
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmakers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmaker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_mappings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slips            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

-- Own rows only.
CREATE POLICY "profiles: read own" ON public.profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);

CREATE POLICY "subscriptions: read own" ON public.subscriptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "payments: read own" ON public.payments
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "slips: read own" ON public.slips
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "selections: read own" ON public.selections
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.slips s
      WHERE s.id = slip_id AND s.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "usage_logs: read own" ON public.usage_logs
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Public reference data.
CREATE POLICY "plans: read active" ON public.plans
  FOR SELECT TO anon, authenticated USING (is_active);

CREATE POLICY "bookmakers: read enabled" ON public.bookmakers
  FOR SELECT TO anon, authenticated USING (is_enabled);
