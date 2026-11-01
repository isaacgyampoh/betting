-- Daily Special Picks: researched selections in specialist statistical markets.
--
-- Hand-written rather than generated, and that is deliberate. `prisma migrate diff` against a
-- development database produced these two tables *and* a drop-then-recreate of five unrelated
-- foreign keys (admin_audit, device_tokens, follows, identities, refresh_tokens) plus a
-- `DROP DEFAULT` on device_tokens.updated_at. That is local drift, not a change anyone intended,
-- and shipping it would briefly drop referential integrity on production tables this feature does
-- not touch. Only the new objects are here.
--
-- Purely additive: two new tables, five indexes, one foreign key between them. Nothing existing is
-- altered or dropped.

CREATE TABLE "special_picks" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "for_date"         DATE NOT NULL,
    "position"         INTEGER NOT NULL,

    "stats_fixture_id" INTEGER NOT NULL,
    "home_team"        TEXT NOT NULL,
    "away_team"        TEXT NOT NULL,
    "competition"      TEXT,
    "country"          TEXT,
    "kickoff_at"       TIMESTAMPTZ NOT NULL,

    "market_kind"      TEXT NOT NULL,
    "market_side"      TEXT NOT NULL,
    "market_period"    TEXT NOT NULL DEFAULT 'FT',
    "line"             DECIMAL(5,2) NOT NULL,
    "outcome"          TEXT NOT NULL,

    -- Null when no bookmaker price could be verified. Never a guess, and never our own estimate
    -- dressed up as a price.
    "bookmaker"        TEXT,
    "raw_market_name"  TEXT,
    "odds"             DECIMAL(10,3),
    "odds_checked_at"  TIMESTAMPTZ,

    -- Our estimate, kept strictly apart from the price above.
    "probability"      DECIMAL(5,4) NOT NULL,
    "confidence"       TEXT NOT NULL,
    "rating"           DECIMAL(6,3) NOT NULL,
    "reason"           TEXT NOT NULL,
    "evidence"         JSONB NOT NULL,
    "researched_at"    TIMESTAMPTZ NOT NULL,

    "status"           "PickStatus" NOT NULL DEFAULT 'PENDING',
    "actual"           DECIMAL(6,2),
    "settled_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_picks_pkey" PRIMARY KEY ("id")
);

-- Every price seen for a selection, including the one it was published at. SpecialPick.odds is
-- never rewritten: a bookmaker moving a line after publication is information, not a correction,
-- and overwriting it would quietly improve the record's apparent value.
CREATE TABLE "special_pick_odds" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "pick_id"    UUID NOT NULL,
    "bookmaker"  TEXT NOT NULL,
    "odds"       DECIMAL(10,3) NOT NULL,
    "line"       DECIMAL(5,2) NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_pick_odds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "special_picks_for_date_idx" ON "special_picks"("for_date");
CREATE INDEX "special_picks_status_kickoff_at_idx" ON "special_picks"("status", "kickoff_at");

-- At most two a day, and a slot cannot be filled twice.
CREATE UNIQUE INDEX "special_picks_for_date_position_key" ON "special_picks"("for_date", "position");

-- Idempotency, which the brief asks for by name: a rerun of the generator cannot republish the
-- same selection, and two correlated lines on one fixture and market cannot both go up.
CREATE UNIQUE INDEX "special_picks_for_date_stats_fixture_id_market_kind_market__key"
    ON "special_picks"("for_date", "stats_fixture_id", "market_kind", "market_side");

CREATE INDEX "special_pick_odds_pick_id_checked_at_idx" ON "special_pick_odds"("pick_id", "checked_at");

ALTER TABLE "special_pick_odds"
    ADD CONSTRAINT "special_pick_odds_pick_id_fkey"
    FOREIGN KEY ("pick_id") REFERENCES "special_picks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
