-- Removes the Supabase coupling from a target database.
--
-- NOT a Prisma migration, and deliberately so. Migrations are applied automatically by CI to
-- whatever DIRECT_URL points at, and this one drops row-level security and a foreign key. A file
-- that does that should be run by a person who has said which database they mean, not by a push.
--
-- Run it against the Render target after `prisma migrate deploy`, and never against Supabase
-- while Supabase is still the rollback.
--
--   psql "$RENDER_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/cutover/001-leave-supabase.sql
--
-- What it removes and why each is safe:
--
--   1. profiles.id -> auth.users.id. There is no auth schema on the target. Identity lives in
--      the `identities` table now; see lib/identity/sign-in.ts.
--   2. on_auth_user_created, the trigger that created a profile per Supabase signup. Already
--      redundant before this change: getProfile() in lib/auth.ts upserts the profile itself and
--      says in a comment that it exists for exactly this case.
--   3. Row Level Security on the public schema. The migration that added it
--      (20260930000100_auth_rls) says in its own header that RLS is there to protect data
--      reached with the anon key through PostgREST, because "Prisma connects as the table owner
--      and bypasses RLS; API routes enforce access themselves". The target runs no PostgREST and
--      exposes no anon key, so these policies guard nothing that is still reachable.
--
-- Point 3 is only true while nothing but the backend can reach this database. That is the
-- arrangement today - Render's access control denies every address that is not allowlisted - and
-- it must not quietly stop being true.

BEGIN;

-- 1. The foreign key into Supabase's auth schema.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 2. The signup trigger and its function.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 3. Policies, then RLS itself, on every table that has it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;

  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

COMMIT;

-- 4. The stub auth schema, last and outside the transaction.
--
-- Only ever a scaffold: `prisma migrate deploy` cannot replay 20260930000100_auth_rls without
-- something called auth.users to point at, so it is created, used and removed.
--
-- CASCADE is required - DROP SCHEMA ... RESTRICT refuses any schema that is not empty, including
-- one holding nothing but its own scaffolding, so it cannot express "drop this unless something
-- outside needs it". The check below expresses that instead, and refuses rather than cascading
-- over a real dependency: if public still points into auth, something has been missed and
-- deleting it silently would be the worst possible outcome.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(conname || ' on ' || conrelid::regclass::text, ', ')
    INTO offenders
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid IN (
       SELECT c.oid FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'auth'
     );

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to drop the auth schema: still referenced by %', offenders;
  END IF;

  EXECUTE 'DROP SCHEMA IF EXISTS auth CASCADE';
END $$;
