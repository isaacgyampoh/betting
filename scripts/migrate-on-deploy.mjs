// Runs `prisma migrate deploy` during Vercel production builds only.
// Preview builds never touch the database. Never runs `migrate dev` (that can reset data).
import { execSync } from "node:child_process";

const target = process.env.VERCEL_ENV;

if (target !== "production") {
  console.log(`[migrate] skipped: VERCEL_ENV=${target ?? "unset"} (migrations only run on production deploys)`);
  process.exit(0);
}
if (!process.env.DIRECT_URL) {
  console.warn("[migrate] WARNING: DIRECT_URL is not set, so migrations were NOT applied. Set it in Vercel → Settings → Environment Variables.");
  process.exit(0);
}

console.log("[migrate] applying pending migrations (prisma migrate deploy)…");
execSync("prisma migrate deploy", { stdio: "inherit" });
