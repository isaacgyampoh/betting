-- One day's published accumulator, as a row of its own.
--
-- The slip is the product and its legs hang off it. It is a table rather than a grouping over
-- special_picks.for_date because a slip carries state no leg does: the reference people share,
-- when its prices were last re-verified, the research summary, and the combined price it was
-- published at.
--
-- Purely additive. Existing legs are backfilled into a slip per day at the bottom, so the record
-- published before slips existed survives intact rather than being reset.

CREATE TABLE "special_slips" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "for_date"         DATE         NOT NULL,
    "reference"        TEXT         NOT NULL,
    "combined_odds"    DECIMAL(10,3) NOT NULL,
    "target"           DECIMAL(6,3)  NOT NULL,
    "summary"          TEXT         NOT NULL,
    "status"           "PickStatus" NOT NULL DEFAULT 'PENDING',
    "settled_at"       TIMESTAMPTZ,
    "published_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ,

    CONSTRAINT "special_slips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "special_slips_for_date_key"  ON "special_slips"("for_date");
CREATE UNIQUE INDEX "special_slips_reference_key" ON "special_slips"("reference");
CREATE INDEX        "special_slips_status_idx"    ON "special_slips"("status");

ALTER TABLE "special_picks" ADD COLUMN "slip_id" UUID;
CREATE INDEX "special_picks_slip_id_idx" ON "special_picks"("slip_id");

ALTER TABLE "special_picks"
    ADD CONSTRAINT "special_picks_slip_id_fkey"
    FOREIGN KEY ("slip_id") REFERENCES "special_slips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every day that already published selections becomes a slip.
--
-- The combined price is the product of the legs that are not void, which is the same rule
-- settlement uses. A day with a leg published without a price gets 0 and is treated as unpriced by
-- the reader, exactly as before. The reference is derived from the date so it is stable if this
-- ever runs again.
INSERT INTO "special_slips" ("for_date", "reference", "combined_odds", "target", "summary", "status", "published_at")
SELECT
    p."for_date",
    'GC' || to_char(p."for_date", 'YYMMDD'),
    COALESCE(ROUND(EXP(SUM(LN(GREATEST(p."odds", 1.0001))))::numeric, 3), 0),
    2,
    'Published before slips were recorded; the research is on each selection.',
    'PENDING',
    MIN(p."created_at")
FROM "special_picks" p
WHERE p."odds" IS NOT NULL AND p."status" <> 'VOID'
GROUP BY p."for_date"
ON CONFLICT ("for_date") DO NOTHING;

UPDATE "special_picks" p
SET "slip_id" = s."id"
FROM "special_slips" s
WHERE s."for_date" = p."for_date" AND p."slip_id" IS NULL;
