-- Following, moved from the device to the server.
--
-- It lived in the app's local database, which meant the server had no idea what anybody followed:
-- it could not have sent a notification even with working credentials, and a reinstall lost the
-- lot. It also could not express following a single match, only a team.

CREATE TYPE "FollowKind" AS ENUM ('FIXTURE', 'TEAM', 'COMPETITION');

CREATE TABLE "follows" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "kind"       "FollowKind" NOT NULL,
  "target_id"  INTEGER NOT NULL,
  "label"      TEXT,
  "muted_at"   TIMESTAMPTZ,
  -- Columns rather than a joined table: five booleans do not earn their own row, and the
  -- alerting path reads them on every goal. Half-time defaults off; it is the one people switch
  -- off first, and an unwanted notification is worse than one you have to turn on.
  "alert_kickoff"   BOOLEAN NOT NULL DEFAULT true,
  "alert_goals"     BOOLEAN NOT NULL DEFAULT true,
  "alert_red_cards" BOOLEAN NOT NULL DEFAULT true,
  "alert_half_time" BOOLEAN NOT NULL DEFAULT false,
  "alert_full_time" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Following twice is following once.
CREATE UNIQUE INDEX "follows_profile_id_kind_target_id_key"
  ON "follows"("profile_id", "kind", "target_id");
-- The alerting side asks "who follows fixture 12345?", which without this is a sequential scan
-- of every follow in the system on every goal.
CREATE INDEX "follows_kind_target_id_idx" ON "follows"("kind", "target_id");

ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;
