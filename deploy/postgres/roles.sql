-- Two roles, because one role doing both jobs is how an application bug becomes a dropped table.
--
-- Runs once, on an empty data directory, as the superuser. Re-running it on an existing volume
-- does nothing: Postgres only executes /docker-entrypoint-initdb.d on first initialisation.
--
--   gameclaw_owner  owns the schema. Prisma migrations connect as this (DIRECT_URL) and it is the
--                   only role that can change structure.
--   gameclaw_app    the running application (DATABASE_URL). Reads and writes rows; cannot create,
--                   drop or alter anything.
--
-- The superuser is then used by nothing. Its password still belongs in a password manager, because
-- it is what recovers the database if either role is lost.

\set ON_ERROR_STOP on

CREATE ROLE gameclaw_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE gameclaw_app   LOGIN PASSWORD :'app_password';

-- The owner owns the database and the public schema, so Prisma's migrations behave exactly as they
-- do on Render today.
ALTER DATABASE :"db_name" OWNER TO gameclaw_owner;
ALTER SCHEMA public OWNER TO gameclaw_owner;

-- Nobody creates objects in public by default. Without this, any role with CONNECT could add a
-- table - still true in Postgres 15+ for the database owner's schema unless it is revoked.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gameclaw_app;
GRANT CONNECT ON DATABASE :"db_name" TO gameclaw_app;

-- Row Level Security: read this before changing the role the application connects as.
--
-- 20260930000100_auth_rls enabled RLS on 25 tables and created 11 policies, all written for
-- Supabase's PostgREST and keyed on auth.uid(). 20261030120000_drop_supabase_coupling deliberately
-- kept them, reasoning that "Prisma connects as the table owner and bypasses them".
--
-- That reasoning is exactly why this needs care. A table's owner bypasses RLS; a different role
-- does not. Pointing the application at a non-owner role without this attribute would make those
-- policies start enforcing for the first time - and an RLS-enabled table with no permissive policy
-- for the current role does not error, it returns zero rows. The Live Centre would render empty,
-- the profile lookup would find nothing, and it would look precisely like data loss.
--
-- So the application keeps the RLS behaviour it has today (bypass) and loses the privilege it
-- should never have had (DDL). The right long-term fix is to drop the eleven dead policies, which
-- is a schema migration and a separate decision - not something to discover during a cutover.
ALTER ROLE gameclaw_app BYPASSRLS;

-- Table-level rights, for tables that do not exist yet: `migrate deploy` creates them as
-- gameclaw_owner, and these defaults apply to everything it creates from then on.
ALTER DEFAULT PRIVILEGES FOR ROLE gameclaw_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gameclaw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gameclaw_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gameclaw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gameclaw_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO gameclaw_app;

-- And for anything already present, which is the case when restoring a dump before migrating.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gameclaw_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gameclaw_app;

-- The extensions the schema relies on. pgcrypto is used by the Supabase-era migrations; creating
-- it here means a restore into a fresh volume does not fail on a missing function.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
