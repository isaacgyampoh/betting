// Builds the app for Cloudflare Workers:
//  1. generate the Workers Prisma client
//  2. `opennextjs-cloudflare build` with NEXT_PUBLIC_* taken from the chosen config's "vars"
//     (process env beats .env.local, so a local dev URL can never leak into a production build)
//
// Which config: `--config <path>`, or WRANGLER_CONFIG, defaulting to wrangler.jsonc. The API
// Worker has its own, and its NEXT_PUBLIC_SITE_URL is its own origin - reading the website's
// vars for an API build would bake gameclaw.win into the bundle and send auth redirects there.
//  3. locally, regenerate the Node Prisma client afterwards so `pnpm dev` and tests keep working
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

// Local CLIs (prisma, opennextjs-cloudflare) resolve even when run as `node scripts/…` outside pnpm.
process.env.PATH = `${resolve("node_modules/.bin")}${delimiter}${process.env.PATH}`;
import { readFileSync } from "node:fs";

const flagIndex = process.argv.indexOf("--config");
const configPath =
  (flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined) ??
  process.env.WRANGLER_CONFIG ??
  "wrangler.jsonc";

const jsonc = readFileSync(configPath, "utf8").replace(/^\s*\/\/.*$/gm, "");
const vars = JSON.parse(jsonc).vars ?? {};
const publicVars = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith("NEXT_PUBLIC_")));

// A placeholder here is a build that looks fine and is wrong everywhere it matters: the site URL
// is inlined into the client bundle and used for OAuth redirects. Fail now, loudly.
const siteUrl = publicVars.NEXT_PUBLIC_SITE_URL ?? "";
if (!siteUrl || siteUrl.includes("REPLACE-ME")) {
  console.error(
    `\n${configPath}: NEXT_PUBLIC_SITE_URL is still a placeholder (${siteUrl || "unset"}).\n` +
      "Set it to this Worker's own origin before building.\n",
  );
  process.exit(1);
}

console.log(`cf:build using ${configPath} (NEXT_PUBLIC_SITE_URL=${siteUrl})`);
const env = { ...process.env, ...publicVars };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env });

run("node", ["scripts/prisma-generate.mjs", "cloudflare"]);
try {
  run("opennextjs-cloudflare", ["build"]);
} finally {
  if (!process.env.WORKERS_CI) run("node", ["scripts/prisma-generate.mjs", "node"]);
}
