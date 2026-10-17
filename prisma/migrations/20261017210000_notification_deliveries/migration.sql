-- One row per alert already sent, so the same event is never announced twice.
--
-- The alerting job re-reads a live match on every pass and sees the same goal again; without
-- this, a 70th-minute goal would be announced every minute until full time. Retries after a
-- failed send would do the same.

CREATE TABLE "notification_deliveries" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  -- Derived from the event itself - fixture, kind, minute, player - so the same goal produces
  -- the same key however many times it is read, and in whatever order.
  "event_key"  TEXT NOT NULL,
  "fixture_id" INTEGER NOT NULL,
  "sent_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The actual guarantee. Two workers racing both attempt the insert; one loses and does not send.
CREATE UNIQUE INDEX "notification_deliveries_profile_id_event_key_key"
  ON "notification_deliveries"("profile_id", "event_key");
CREATE INDEX "notification_deliveries_fixture_id_idx" ON "notification_deliveries"("fixture_id");
CREATE INDEX "notification_deliveries_sent_at_idx" ON "notification_deliveries"("sent_at");

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
