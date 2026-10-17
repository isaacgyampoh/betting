-- GameClaw's own identity tables, replacing what Supabase Auth held.
--
-- Additive only. Nothing here drops the Supabase coupling - that is a separate migration run at
-- cutover, because while both systems are live the auth.users foreign key must keep working.

CREATE TABLE "identities" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id"   UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "provider"     TEXT NOT NULL,
  "subject"      TEXT NOT NULL,
  "email"        TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The identity itself. Matching is on this pair and never on the email alone.
CREATE UNIQUE INDEX "identities_provider_subject_key" ON "identities"("provider", "subject");
CREATE INDEX "identities_profile_id_idx" ON "identities"("profile_id");

CREATE TABLE "refresh_tokens" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  -- SHA-256 hex, never the token. A leaked dump should not be a set of working sessions.
  "token_hash" TEXT NOT NULL,
  "family_id"  UUID NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "user_agent" TEXT
);
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_profile_id_idx" ON "refresh_tokens"("profile_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
-- The cleanup cron deletes expired rows; without this that is a sequential scan.
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

CREATE TABLE "admin_audit" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id"   UUID NOT NULL REFERENCES "profiles"("id"),
  "action"     TEXT NOT NULL,
  "target"     TEXT,
  "detail"     JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "admin_audit_created_at_idx" ON "admin_audit"("created_at");
CREATE INDEX "admin_audit_actor_id_idx" ON "admin_audit"("actor_id");

CREATE TABLE "app_settings" (
  "key"         TEXT PRIMARY KEY,
  "value"       JSONB NOT NULL,
  "description" TEXT,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by"  UUID
);

-- What Supabase kept in auth.users and we now keep ourselves.
ALTER TABLE "profiles" ADD COLUMN "last_sign_in_at"  TIMESTAMPTZ;
ALTER TABLE "profiles" ADD COLUMN "suspended_at"     TIMESTAMPTZ;
ALTER TABLE "profiles" ADD COLUMN "suspended_reason" TEXT;

-- Carry across what Supabase already knows, so the admin dashboard is not blank on day one and
-- so the 7 existing Google users are linked before they next sign in rather than at first touch.
--
-- Guarded: on a target database with no auth schema - which is the whole point of the move -
-- this block does nothing and the migration still succeeds.
DO $$
BEGIN
  -- Guarded on the exact columns, not on the schema. The target database has no auth schema at
  -- all, and the integration harness has a cut-down stub of auth.users with three columns - so
  -- "does the schema exist" was true in a place where the columns were not, and the migration
  -- failed there instead of skipping.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'last_sign_in_at'
  ) THEN
    UPDATE profiles p
       SET last_sign_in_at = u.last_sign_in_at
      FROM auth.users u
     WHERE u.id = p.id AND u.last_sign_in_at IS NOT NULL;

  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) THEN
    INSERT INTO identities (profile_id, provider, subject, email, created_at, last_seen_at)
    SELECT i.user_id, i.provider, i.provider_id, i.identity_data ->> 'email',
           i.created_at, COALESCE(i.last_sign_in_at, i.created_at)
      FROM auth.identities i
      JOIN profiles p ON p.id = i.user_id
     WHERE i.provider = 'google'
    ON CONFLICT (provider, subject) DO NOTHING;
  END IF;
END $$;

-- RLS, to match every other table. No policy means deny-all to the anon key, which is correct:
-- nothing here should ever be readable by a client, and all three are server-only.
ALTER TABLE "identities"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_audit"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_settings"   ENABLE ROW LEVEL SECURITY;

-- Sign-in and refresh are metered through the same limiter as everything else, so they need a
-- kind of their own. Without it an unauthenticated endpoint has no ceiling at all.
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'AUTH';
