-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('MATCH_RESULT', 'DOUBLE_CHANCE', 'DRAW_NO_BET', 'OVER_UNDER', 'BTTS', 'HANDICAP', 'ASIAN_HANDICAP', 'CORRECT_SCORE', 'HT_FT', 'ODD_EVEN', 'TEAM_OVER_UNDER');

-- CreateEnum
CREATE TYPE "MarketPeriod" AS ENUM ('FT', 'H1', 'H2');

-- CreateEnum
CREATE TYPE "SlipKind" AS ENUM ('LOADED', 'CONVERTED', 'EDITED', 'SPLIT');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('OK', 'EVENT_NOT_FOUND', 'MARKET_NOT_FOUND');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('SLIP_LOAD', 'SLIP_CONVERT', 'SLIP_EDIT', 'STATS', 'AI_CHAT', 'AI_ANALYSIS');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "age_confirmed_at" TIMESTAMPTZ,
    "free_ai_credits" INTEGER NOT NULL DEFAULT 5,
    "telegram_chat_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_pesewas" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "duration_days" INTEGER NOT NULL,
    "daily_ai_requests" INTEGER NOT NULL,
    "daily_token_limit" INTEGER NOT NULL,
    "allow_deep_analysis" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "paystack_subscription_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "subscription_id" UUID,
    "reference" TEXT NOT NULL,
    "amount_pesewas" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "paid_at" TIMESTAMPTZ,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmakers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'GH',
    "website" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "country" TEXT,
    "api_football_team_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "bookmaker_id" UUID,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport" TEXT NOT NULL DEFAULT 'football',
    "home_team_id" UUID NOT NULL,
    "away_team_id" UUID NOT NULL,
    "kickoff_at" TIMESTAMPTZ NOT NULL,
    "competition" TEXT,
    "country" TEXT,
    "api_football_fixture_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmaker_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookmaker_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "event_id" UUID,
    "home_name" TEXT NOT NULL,
    "away_name" TEXT NOT NULL,
    "kickoff_at" TIMESTAMPTZ NOT NULL,
    "competition" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmaker_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookmaker_id" UUID NOT NULL,
    "external_market_id" TEXT NOT NULL,
    "external_outcome_id" TEXT NOT NULL,
    "specifier" TEXT NOT NULL DEFAULT '',
    "market_type" "MarketType" NOT NULL,
    "period" "MarketPeriod" NOT NULL DEFAULT 'FT',
    "outcome" TEXT NOT NULL,
    "line" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "bookmaker_id" UUID NOT NULL,
    "kind" "SlipKind" NOT NULL,
    "booking_code" TEXT,
    "parent_slip_id" UUID,
    "total_odds" DECIMAL(14,3),
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slip_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "event_id" UUID,
    "bookmaker_event_id" UUID,
    "home_team" TEXT NOT NULL,
    "away_team" TEXT NOT NULL,
    "kickoff_at" TIMESTAMPTZ NOT NULL,
    "competition" TEXT,
    "market_type" "MarketType" NOT NULL,
    "period" "MarketPeriod" NOT NULL DEFAULT 'FT',
    "outcome" TEXT NOT NULL,
    "line" DECIMAL(6,2),
    "odds" DECIMAL(10,3),
    "raw_market_name" TEXT,
    "raw_outcome_name" TEXT,
    "raw" JSONB,
    "status" "SelectionStatus" NOT NULL DEFAULT 'OK',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_cache" (
    "bookmaker_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_cache_pkey" PRIMARY KEY ("bookmaker_id","code")
);

-- CreateTable
CREATE TABLE "stats_cache" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stats_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "ip_hash" TEXT,
    "kind" "UsageKind" NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_telegram_chat_id_key" ON "profiles"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_paystack_subscription_code_key" ON "subscriptions"("paystack_subscription_code");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_ends_at_idx" ON "subscriptions"("user_id", "status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookmakers_slug_key" ON "bookmakers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "teams_api_football_team_id_key" ON "teams"("api_football_team_id");

-- CreateIndex
CREATE INDEX "teams_normalized_name_idx" ON "teams"("normalized_name");

-- CreateIndex
CREATE INDEX "team_aliases_normalized_idx" ON "team_aliases"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "team_aliases_normalized_bookmaker_id_key" ON "team_aliases"("normalized", "bookmaker_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_api_football_fixture_id_key" ON "events"("api_football_fixture_id");

-- CreateIndex
CREATE INDEX "events_kickoff_at_idx" ON "events"("kickoff_at");

-- CreateIndex
CREATE UNIQUE INDEX "events_home_team_id_away_team_id_kickoff_at_key" ON "events"("home_team_id", "away_team_id", "kickoff_at");

-- CreateIndex
CREATE INDEX "bookmaker_events_event_id_idx" ON "bookmaker_events"("event_id");

-- CreateIndex
CREATE INDEX "bookmaker_events_kickoff_at_idx" ON "bookmaker_events"("kickoff_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookmaker_events_bookmaker_id_external_id_key" ON "bookmaker_events"("bookmaker_id", "external_id");

-- CreateIndex
CREATE INDEX "market_mappings_bookmaker_id_market_type_period_outcome_lin_idx" ON "market_mappings"("bookmaker_id", "market_type", "period", "outcome", "line");

-- CreateIndex
CREATE UNIQUE INDEX "market_mappings_bookmaker_id_external_market_id_external_ou_key" ON "market_mappings"("bookmaker_id", "external_market_id", "external_outcome_id", "specifier");

-- CreateIndex
CREATE INDEX "slips_user_id_created_at_idx" ON "slips"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "slips_bookmaker_id_booking_code_idx" ON "slips"("bookmaker_id", "booking_code");

-- CreateIndex
CREATE INDEX "selections_slip_id_position_idx" ON "selections"("slip_id", "position");

-- CreateIndex
CREATE INDEX "code_cache_expires_at_idx" ON "code_cache"("expires_at");

-- CreateIndex
CREATE INDEX "stats_cache_expires_at_idx" ON "stats_cache"("expires_at");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_kind_created_at_idx" ON "usage_logs"("user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "usage_logs_ip_hash_kind_created_at_idx" ON "usage_logs"("ip_hash", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_bookmaker_id_fkey" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmaker_events" ADD CONSTRAINT "bookmaker_events_bookmaker_id_fkey" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmaker_events" ADD CONSTRAINT "bookmaker_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_mappings" ADD CONSTRAINT "market_mappings_bookmaker_id_fkey" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "slips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "slips_bookmaker_id_fkey" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "slips_parent_slip_id_fkey" FOREIGN KEY ("parent_slip_id") REFERENCES "slips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_slip_id_fkey" FOREIGN KEY ("slip_id") REFERENCES "slips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_bookmaker_event_id_fkey" FOREIGN KEY ("bookmaker_event_id") REFERENCES "bookmaker_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_cache" ADD CONSTRAINT "code_cache_bookmaker_id_fkey" FOREIGN KEY ("bookmaker_id") REFERENCES "bookmakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

