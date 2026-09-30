import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; load it for the Prisma CLI too.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection.
    url: process.env.DIRECT_URL ?? "",
  },
});
