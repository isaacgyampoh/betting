-- Daily pick legs could never be settled: nothing recorded which market the pick was, so a final
-- score could not decide it, and the public record would have stayed "pending" for ever.
ALTER TABLE "daily_pick_legs" ADD COLUMN "market" jsonb;
