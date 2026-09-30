-- CreateEnum
CREATE TYPE "PickStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID');

-- CreateTable
CREATE TABLE "daily_picks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "for_date" DATE NOT NULL,
    "target" INTEGER NOT NULL,
    "total_odds" DECIMAL(10,3) NOT NULL,
    "probability" DECIMAL(5,4) NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" "PickStatus" NOT NULL DEFAULT 'PENDING',
    "settled_at" TIMESTAMPTZ,
    "min_plan_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_pick_legs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pick_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "home_team" TEXT NOT NULL,
    "away_team" TEXT NOT NULL,
    "competition" TEXT,
    "kickoff_at" TIMESTAMPTZ NOT NULL,
    "api_football_fixture_id" INTEGER,
    "market_label" TEXT NOT NULL,
    "pick_label" TEXT NOT NULL,
    "odds" DECIMAL(10,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PickStatus" NOT NULL DEFAULT 'PENDING',
    "result_text" TEXT,

    CONSTRAINT "daily_pick_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_picks_for_date_idx" ON "daily_picks"("for_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_picks_for_date_target_key" ON "daily_picks"("for_date", "target");

-- CreateIndex
CREATE INDEX "daily_pick_legs_pick_id_position_idx" ON "daily_pick_legs"("pick_id", "position");

-- AddForeignKey
ALTER TABLE "daily_pick_legs" ADD CONSTRAINT "daily_pick_legs_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "daily_picks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The track record is public: anyone may read published picks, nobody may write via the anon key.
ALTER TABLE "daily_picks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_pick_legs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_picks: public read" ON "daily_picks" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "daily_pick_legs: public read" ON "daily_pick_legs" FOR SELECT TO anon, authenticated USING (true);
