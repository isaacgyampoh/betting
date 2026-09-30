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
  {
    code: "daily",
    name: "Day Pass",
    pricePesewas: 500,
    durationDays: 1,
    dailyAiRequests: 30,
    dailyTokenLimit: 60_000,
    allowDeepAnalysis: false,
    sortOrder: 1,
  },
  {
    code: "weekly",
    name: "Weekly",
    pricePesewas: 2500,
    durationDays: 7,
    dailyAiRequests: 50,
    dailyTokenLimit: 100_000,
    allowDeepAnalysis: true,
    sortOrder: 2,
  },
  {
    code: "monthly",
    name: "Monthly",
    pricePesewas: 8000,
    durationDays: 30,
    dailyAiRequests: 80,
    dailyTokenLimit: 150_000,
    allowDeepAnalysis: true,
    sortOrder: 3,
  },
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
