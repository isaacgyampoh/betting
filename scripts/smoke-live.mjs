// Signs up as a brand-new user on a running site and walks every tab, on a phone-sized viewport.
//
// This exists because the unit and integration suites cannot see the things that have broken the
// live site: Hyperdrive's query cache serving a stale profile, a bundler rewriting an inline script
// into something the browser cannot run, a service worker holding an old build. All of those pass
// every test and lock real people out. The only way to catch them is to be a real person.
//
//   SERVICE_KEY=... node scripts/smoke-live.mjs                 # against production
//   SITE=http://localhost:3123 SERVICE_KEY=... node scripts/... # against a local server
//
// SERVICE_KEY is the Supabase service-role key, used only to create and then delete one throwaway
// account. It never leaves this machine.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SITE = (process.env.SITE ?? "https://gameclaw.win").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qefedcphkmxuxjetmtqw.supabase.co";
const key = process.env.SERVICE_KEY;
if (!key) {
  console.error("Set SERVICE_KEY (Supabase service-role key). See docs/deploy.md.");
  process.exit(2);
}

// What each tab must actually show. Checking the URL alone is not enough: the welcome redirect loop
// kept the URL plausible while the page was the 18+ gate.
const TABS = [
  { name: "Chat", path: "/chat", wants: "What do you want to do?" },
  { name: "Slip", path: "/slip", wants: "Load a booking code" },
  { name: "Picks", path: "/picks", wants: "Daily picks" },
  { name: "Matches", path: "/matches", wants: "Fixtures and head-to-head" },
  { name: "Account", path: "/account", wants: "Plan" },
];

const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
const email = `smoke-${randomBytes(5).toString("hex")}@example.com`;
const failures = [];
const errors = [];
let user;
let browser;

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError) throw createError;
  user = created.user;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().split("\n")[0].slice(0, 160)));

  console.log(`${SITE} — signing up as a new user`);
  await page.goto(`${SITE}/auth/confirm?next=%2Fchat&token_hash=${link.properties.hashed_token}&type=email`);
  await page.waitForURL(/\/welcome/, { timeout: 60_000 });

  await page.click("#over18");
  await page.click("#terms");
  await page.click("button:has-text('Continue')");
  try {
    await page.waitForURL(/\/chat/, { timeout: 30_000 });
    console.log("  18+ confirmation -> chat");
  } catch {
    failures.push(`confirming 18+ left the user on ${new URL(page.url()).pathname} — they cannot get in at all`);
  }

  for (const tab of TABS) {
    await page.goto(`${SITE}${tab.path}`);
    const started = Date.now();
    let ok = true;
    try {
      await page.waitForFunction((text) => document.querySelector("main")?.innerText.includes(text), tab.wants, { timeout: 25_000 });
    } catch {
      ok = false;
    }
    const where = new URL(page.url()).pathname;
    const ms = Date.now() - started;
    console.log(`  ${tab.name.padEnd(8)} ${String(ms).padStart(6)}ms  ${where}${ok ? "" : `  <-- never showed "${tab.wants}"`}`);
    if (!ok || where !== tab.path) failures.push(`${tab.name}: ended on ${where}${ok ? "" : `, without "${tab.wants}"`}`);
  }

  // A page that throws on load may still look right while nothing on it works.
  const unique = [...new Set(errors)];
  if (unique.length) {
    console.log("\nbrowser errors:");
    for (const e of unique.slice(0, 10)) console.log(`  ${e}`);
    failures.push(`${unique.length} browser error${unique.length === 1 ? "" : "s"} on load`);
  }
} finally {
  await browser?.close();
  if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
}

if (failures.length) {
  console.error(`\nFAILED\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nOK — a new user can sign up and every tab works.");
