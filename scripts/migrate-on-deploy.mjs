// Applies pending migrations (`prisma migrate deploy`, never `migrate dev`) before a production deploy.
// Runs in Cloudflare Workers Builds on the production branch, or locally with MIGRATE=1.
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

// Local CLIs (prisma, opennextjs-cloudflare) resolve even when run as `node scripts/…` outside pnpm.
process.env.PATH = `${resolve("node_modules/.bin")}${delimiter}${process.env.PATH}`;

const productionBuild = process.env.WORKERS_CI === "1" && process.env.WORKERS_CI_BRANCH === "main";
if (!productionBuild && process.env.MIGRATE !== "1") {
  console.log("[migrate] skipped (not a production build; set MIGRATE=1 to force)");
  process.exit(0);
}
if (!process.env.DIRECT_URL) {
  console.error("[migrate] DIRECT_URL is not set; refusing to deploy without applying migrations.");
  process.exit(1);
}
console.log("[migrate] applying pending migrations…");
execFileSync("prisma", ["migrate", "deploy"], { stdio: "inherit" });
