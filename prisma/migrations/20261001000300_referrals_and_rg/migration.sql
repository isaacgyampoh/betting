-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "excluded_until" TIMESTAMPTZ,
ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referred_by_id" UUID,
ADD COLUMN     "reminders_on" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spend_note_pesewas" INTEGER;

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_user_id_referred_user_id_key" ON "referral_rewards"("user_id", "referred_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_referral_code_key" ON "profiles"("referral_code");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Server-only, like the other user tables.
ALTER TABLE "referral_rewards" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referral_rewards: read own" ON "referral_rewards" FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
