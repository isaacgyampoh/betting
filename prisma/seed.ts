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
  { code: "free", name: "Free", description: "Slip tools, a few chats a day.", pricePesewas: 0, durationDays: 0, dailyAiRequests: 3, dailyTokenLimit: 20_000, dailyUploads: 1, dailySlipBuilds: 1, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 0 },
  { code: "starter", name: "Starter", description: "A day of everyday use.", pricePesewas: 1000, durationDays: 1, dailyAiRequests: 15, dailyTokenLimit: 80_000, dailyUploads: 3, dailySlipBuilds: 2, dailyAnalyses: 0, allowDeepAnalysis: false, allowDailyPicks: false, sortOrder: 1 },
  { code: "pro", name: "Pro", description: "A week, with analysis and the daily picks.", pricePesewas: 4500, durationDays: 7, dailyAiRequests: 40, dailyTokenLimit: 200_000, dailyUploads: 10, dailySlipBuilds: 10, dailyAnalyses: 3, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 2 },
  { code: "vip", name: "VIP", description: "A month, with the highest limits.", pricePesewas: 12000, durationDays: 30, dailyAiRequests: 100, dailyTokenLimit: 500_000, dailyUploads: 30, dailySlipBuilds: -1, dailyAnalyses: 10, allowDeepAnalysis: true, allowDailyPicks: true, sortOrder: 3 },
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
