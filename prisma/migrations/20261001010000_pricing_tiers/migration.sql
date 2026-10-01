-- Starter / Pro / VIP, each buyable by day, week or month. Prices in pesewas; change them here or
-- in the plans table without a deploy. Limits are per tier and identical across durations.
--
-- VIP slip builds are a high finite number rather than unlimited: unlimited is the only item whose
-- worst case is unbounded, and the monthly price cannot absorb it.
INSERT INTO "plans" ("id","code","name","description","price_pesewas","currency","duration_days",
                     "daily_ai_requests","daily_token_limit","allow_deep_analysis","daily_uploads",
                     "daily_slip_builds","daily_analyses","allow_daily_picks","is_active","sort_order","updated_at")
VALUES
  (gen_random_uuid(),'free','Free','Paste, view and convert codes.',0,'GHS',0,
     3, 20000, false, 1, 1, 0, false, true, 0, now()),

  (gen_random_uuid(),'starter_day','Starter','Everyday use for a day.',500,'GHS',1,
     15, 80000, false, 3, 2, 0, false, true, 10, now()),
  (gen_random_uuid(),'starter_week','Starter','Everyday use for a week.',2000,'GHS',7,
     15, 80000, false, 3, 2, 0, false, true, 11, now()),
  (gen_random_uuid(),'starter_month','Starter','Everyday use for a month.',6000,'GHS',30,
     15, 80000, false, 3, 2, 0, false, true, 12, now()),

  (gen_random_uuid(),'pro_day','Pro','Analysis and the daily picks, for a day.',1000,'GHS',1,
     40, 200000, true, 10, 10, 3, true, true, 20, now()),
  (gen_random_uuid(),'pro_week','Pro','Analysis and the daily picks, for a week.',4000,'GHS',7,
     40, 200000, true, 10, 10, 3, true, true, 21, now()),
  (gen_random_uuid(),'pro_month','Pro','Analysis and the daily picks, for a month.',12000,'GHS',30,
     40, 200000, true, 10, 10, 3, true, true, 22, now()),

  (gen_random_uuid(),'vip_day','VIP','Everything, highest limits, for a day.',1500,'GHS',1,
     100, 500000, true, 30, 30, 10, true, true, 30, now()),
  (gen_random_uuid(),'vip_week','VIP','Everything, highest limits, for a week.',7000,'GHS',7,
     100, 500000, true, 30, 30, 10, true, true, 31, now()),
  (gen_random_uuid(),'vip_month','VIP','Everything, highest limits, for a month.',20000,'GHS',30,
     100, 500000, true, 30, 30, 10, true, true, 32, now())
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name","description"=EXCLUDED."description","price_pesewas"=EXCLUDED."price_pesewas",
  "duration_days"=EXCLUDED."duration_days","daily_ai_requests"=EXCLUDED."daily_ai_requests",
  "daily_token_limit"=EXCLUDED."daily_token_limit","allow_deep_analysis"=EXCLUDED."allow_deep_analysis",
  "daily_uploads"=EXCLUDED."daily_uploads","daily_slip_builds"=EXCLUDED."daily_slip_builds",
  "daily_analyses"=EXCLUDED."daily_analyses","allow_daily_picks"=EXCLUDED."allow_daily_picks",
  "is_active"=true,"sort_order"=EXCLUDED."sort_order";

-- Retire the previous single-duration tiers from the pricing page. Anyone mid-subscription keeps
-- their access until it expires, because subscriptions reference the plan row by id.
UPDATE "plans" SET "is_active"=false WHERE "code" IN ('daily','weekly','monthly','starter','pro','vip');
