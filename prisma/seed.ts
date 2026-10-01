import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

// Starting prices; change them in the DB (plans table), not here.
const plans = [
  { code: "free", name: "Free", description: "Paste, view and convert codes.", pricePesewas: 0, durationDays: 0, dailyAiRequests: 3, dailyTokenLimit: 20000, dailyUploads: 1, dailySlipBuilds: 1, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 0 },
  { code: "starter_day", name: "Starter", description: "Everyday use for a day.", pricePesewas: 500, durationDays: 1, dailyAiRequests: 15, dailyTokenLimit: 80000, dailyUploads: 3, dailySlipBuilds: 2, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 10 },
  { code: "starter_week", name: "Starter", description: "Everyday use for a week.", pricePesewas: 2000, durationDays: 7, dailyAiRequests: 15, dailyTokenLimit: 80000, dailyUploads: 3, dailySlipBuilds: 2, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 11 },
  { code: "starter_month", name: "Starter", description: "Everyday use for a month.", pricePesewas: 6000, durationDays: 30, dailyAiRequests: 15, dailyTokenLimit: 80000, dailyUploads: 3, dailySlipBuilds: 2, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 12 },
  { code: "pro_day", name: "Pro", description: "Analysis and the daily picks, for a day.", pricePesewas: 1000, durationDays: 1, dailyAiRequests: 40, dailyTokenLimit: 200000, dailyUploads: 10, dailySlipBuilds: 10, dailyAnalyses: 3, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 20 },
  { code: "pro_week", name: "Pro", description: "Analysis and the daily picks, for a week.", pricePesewas: 4000, durationDays: 7, dailyAiRequests: 40, dailyTokenLimit: 200000, dailyUploads: 10, dailySlipBuilds: 10, dailyAnalyses: 3, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 21 },
  { code: "pro_month", name: "Pro", description: "Analysis and the daily picks, for a month.", pricePesewas: 12000, durationDays: 30, dailyAiRequests: 40, dailyTokenLimit: 200000, dailyUploads: 10, dailySlipBuilds: 10, dailyAnalyses: 3, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 22 },
  { code: "vip_day", name: "VIP", description: "Everything, highest limits, for a day.", pricePesewas: 1500, durationDays: 1, dailyAiRequests: 100, dailyTokenLimit: 500000, dailyUploads: 30, dailySlipBuilds: 30, dailyAnalyses: 10, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 30 },
  { code: "vip_week", name: "VIP", description: "Everything, highest limits, for a week.", pricePesewas: 7000, durationDays: 7, dailyAiRequests: 100, dailyTokenLimit: 500000, dailyUploads: 30, dailySlipBuilds: 30, dailyAnalyses: 10, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 31 },
  { code: "vip_month", name: "VIP", description: "Everything, highest limits, for a month.", pricePesewas: 20000, durationDays: 30, dailyAiRequests: 100, dailyTokenLimit: 500000, dailyUploads: 30, dailySlipBuilds: 30, dailyAnalyses: 10, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 32 },
];

const bookmakers = [
  { slug: "sportybet", name: "SportyBet", website: "https://www.sportybet.com/gh", isEnabled: true },
  { slug: "betway", name: "Betway", website: "https://www.betway.com.gh", isEnabled: true },
  { slug: "1xbet", name: "1xBet", website: "https://1xbet.com.gh", isEnabled: true },
  { slug: "betpawa", name: "betPawa", website: "https://www.betpawa.com.gh", isEnabled: true },
  { slug: "msport", name: "MSport", website: "https://www.msport.com/gh", isEnabled: true },
  { slug: "footballcom", name: "Football.com", website: "https://www.football.com/gh", isEnabled: true },
  { slug: "betwinner", name: "Betwinner", website: "https://betwinner.com", isEnabled: true },
  { slug: "22bet", name: "22Bet", website: "https://22bet.com", isEnabled: true },
  { slug: "paripesa", name: "PariPesa", website: "https://paripesa.com", isEnabled: true },
];

async function main() {
  for (const plan of plans) {
    // Only create; never overwrite prices an admin has changed in the DB.
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
  for (const bm of bookmakers) {
    await prisma.bookmaker.upsert({ where: { slug: bm.slug }, create: bm, update: { name: bm.name, isEnabled: bm.isEnabled } });
  }
  console.log(`Seeded ${plans.length} plans and ${bookmakers.length} bookmakers.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
