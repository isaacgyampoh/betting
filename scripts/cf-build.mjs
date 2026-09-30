// Builds the app for Cloudflare Workers:
//  1. generate the Workers Prisma client
//  2. `opennextjs-cloudflare build` with NEXT_PUBLIC_* taken from wrangler.jsonc "vars"
//     (process env beats .env.local, so a local dev URL can never leak into a production build)
//  3. locally, regenerate the Node Prisma client afterwards so `pnpm dev` and tests keep working
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const jsonc = readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
const vars = JSON.parse(jsonc).vars ?? {};
const publicVars = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith("NEXT_PUBLIC_")));
const env = { ...process.env, ...publicVars };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env });

run("node", ["scripts/prisma-generate.mjs", "cloudflare"]);
try {
  run("opennextjs-cloudflare", ["build"]);
} finally {
  if (!process.env.WORKERS_CI) run("node", ["scripts/prisma-generate.mjs", "node"]);
}
