-- The cutover drop that 20261017120000_own_identity said would follow, and never did.
--
-- That migration created GameClaw's own identity tables and noted it was "additive only. Nothing
-- here drops the Supabase coupling - that is a separate migration run at cutover." The cutover
-- happened; this migration did not. The result is a profiles table that still insists every row
-- correspond to a row in auth.users, a table nothing writes to any more.
--
-- What that breaks, precisely: lib/identity/sign-in.ts case 3 - somebody signing in who has no
-- profile yet - does `db.profile.create({ id: crypto.randomUUID(), ... })`. With the foreign key
-- in place that INSERT violates profiles_id_fkey, because no auth.users row exists for a UUID we
-- just invented and Supabase is gone, so nothing will ever create one. Every brand-new account
-- fails. Existing users are unaffected: they have auth.users rows from the Supabase era and sign
-- in through case 1 or case 2, which is why this has not been visible.
--
-- Found by tests/integration/apple-linking.int.test.ts, which creates fresh profiles and could
-- not. The same break applies to Google sign-in; it is not specific to Apple.
--
-- Safe to run: nothing reads auth.users any more. lib/identity/* resolves identities from the
-- `identities` table, and lib/auth.ts verifies our own tokens. The ON DELETE CASCADE being removed
-- only ever fired when Supabase deleted a user, which it can no longer do.

-- 1. The foreign key that blocks new profiles.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 2. The trigger that mirrored a Supabase signup into profiles. Nothing inserts into auth.users
--    now, so it never fires; dropping it stops it being resurrected by a future auth.users write.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Deliberately NOT dropped:
--
--   * the auth schema and auth.users themselves. They still hold the rows the original seven
--     accounts were created from, and profiles.id values match them. Dropping the table would
--     destroy the only record of where those ids came from, and it buys nothing - an unreferenced
--     table costs a few kilobytes.
--
--   * Row Level Security policies referencing auth.uid(). They are read-only policies guarding
--     access through PostgREST with the anon key. Prisma connects as the table owner and bypasses
--     them, and every write goes through /api/v1. Removing them would widen access, not narrow it.
