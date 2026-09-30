-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "allow_daily_picks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "daily_analyses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "daily_slip_builds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "daily_uploads" INTEGER NOT NULL DEFAULT 0;


-- Free / Starter / Pro / VIP. Prices in pesewas; change them here or in the plans table, no deploy needed.
-- Existing plan codes are kept (old subscriptions keep working) but retired from the pricing page.
INSERT INTO "plans" ("id", "code", "name", "description", "price_pesewas", "currency", "duration_days",
                     "daily_ai_requests", "daily_token_limit", "allow_deep_analysis", "daily_uploads",
                     "daily_slip_builds", "daily_analyses", "allow_daily_picks", "is_active", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'free',    'Free',    'Slip tools, a few chats a day.',            0,     'GHS',  0,  3,  20000, false,  1,  1, 0, false, true, 0, now()),
  (gen_random_uuid(), 'starter', 'Starter', 'A day of everyday use.',                    1000,  'GHS',  1,  15, 80000, false,  3,  2, 0, false, true, 1, now()),
  (gen_random_uuid(), 'pro',     'Pro',     'A week, with analysis and the daily picks.',4500,  'GHS',  7,  40, 200000, true,  10, 10, 3, true,  true, 2, now()),
  (gen_random_uuid(), 'vip',     'VIP',     'A month, with the highest limits.',         12000, 'GHS', 30, 100, 500000, true,  30, -1, 10, true, true, 3, now())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name", "description" = EXCLUDED."description", "duration_days" = EXCLUDED."duration_days",
  "daily_ai_requests" = EXCLUDED."daily_ai_requests", "daily_token_limit" = EXCLUDED."daily_token_limit",
  "allow_deep_analysis" = EXCLUDED."allow_deep_analysis", "daily_uploads" = EXCLUDED."daily_uploads",
  "daily_slip_builds" = EXCLUDED."daily_slip_builds", "daily_analyses" = EXCLUDED."daily_analyses",
  "allow_daily_picks" = EXCLUDED."allow_daily_picks", "is_active" = true, "sort_order" = EXCLUDED."sort_order";

-- Retire the old plans from the pricing page; anyone mid-subscription keeps their access.
UPDATE "plans" SET "is_active" = false WHERE "code" IN ('daily', 'weekly', 'monthly');

-- Old plans keep sensible per-feature limits so existing subscribers aren't cut off.
UPDATE "plans" SET "daily_uploads" = 3, "daily_slip_builds" = 3, "daily_analyses" = 0 WHERE "code" = 'daily';
UPDATE "plans" SET "daily_uploads" = 10, "daily_slip_builds" = 10, "daily_analyses" = 3, "allow_daily_picks" = true WHERE "code" = 'weekly';
UPDATE "plans" SET "daily_uploads" = 20, "daily_slip_builds" = 20, "daily_analyses" = 5, "allow_daily_picks" = true WHERE "code" = 'monthly';
