// Checks a deployed gameclaw.win against what it is supposed to be.
//
//   node scripts/smoke-live.mjs                      # production
//   SITE=https://gameclaw.win node scripts/...       # the same, explicitly
//
// What this used to be, and why it is not that any more. It signed up a throwaway Supabase user
// and drove a browser through /chat, /slip, /picks, /matches and /account on a phone-sized
// viewport. Both halves of that have gone: the Supabase project it created the user in has been
// deleted, and those five routes are no longer served on gameclaw.win at all - worker.ts redirects
// them, because the web app's sign-in ran through that same Supabase project and a visitor who
// found one spent their attempt on a form that could not work.
//
// So this checks the site that actually exists: the marketing pages, and the /api/v1 forwarder
// that replaced the website's dead database connection. That forwarder is the thing most worth a
// live check, because nothing in the unit suite can tell whether the real Render service is
// answering - tests/worker/api-forward.test.ts stubs it on purpose.
//
// No credentials, nothing written, nothing created or deleted. Safe to run against production.

const SITE = (process.env.SITE ?? "https://gameclaw.win").replace(/\/$/, "");
const API = "https://gameclaw-api.onrender.com";

const failures = [];
const lines = [];

function record(name, ok, detail) {
  lines.push(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(44)} ${detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function get(url, init) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json,text/html" },
      signal: AbortSignal.timeout(45_000),
      ...init,
    });
    return { res, ms: Date.now() - started };
  } catch (err) {
    return { err, ms: Date.now() - started };
  }
}

// 1. The pages a visitor actually lands on.
console.log(`${SITE} — marketing pages`);
for (const path of ["/", "/pricing", "/track-record", "/support", "/login"]) {
  const { res, err, ms } = await get(`${SITE}${path}`);
  record(path, !err && res.status === 200, err ? String(err.message) : `${res.status} in ${ms}ms`);
}

// 2. The forwarder, which is the point of this deploy. A healthy database here means the request
//    reached Render: the Worker has no database connection of its own and cannot fake this.
console.log("\n/api/v1 forwarded to the API");
{
  const { res, err } = await get(`${SITE}/api/v1/health`);
  if (err) {
    record("/api/v1/health", false, String(err.message));
  } else {
    const body = await res.json().catch(() => null);
    const status = body?.data?.status;
    record("/api/v1/health", res.status === 200 && status === "ok", `${res.status} status=${status}`);
    // The old failure, named so a regression is recognisable rather than just red.
    if (status === "database_unreachable") {
      failures.push("health says database_unreachable — the Worker is serving /api/v1 itself again");
    }
  }
}

for (const path of [
  "/api/v1/matches",
  "/api/v1/picks",
  "/api/v1/picks/track-record",
  "/api/v1/plans",
  "/api/v1/bookmakers",
  "/api/v1/bookmakers/catalogue",
  "/api/v1/competitions",
]) {
  const { res, err, ms } = await get(`${SITE}${path}`);
  if (err) {
    record(path, false, String(err.message));
    continue;
  }
  const type = res.headers.get("content-type") ?? "";
  record(path, res.status < 400 && type.includes("json"), `${res.status} ${type.split(";")[0]} in ${ms}ms`);
  // Nothing on the allowlist sets a cookie. One arriving means the response is being rebuilt
  // wrongly, on the origin where the admin session cookie also lives.
  if (res.headers.get("set-cookie")) record(`${path} set-cookie`, false, "upstream cookie reached the browser");
}

// 3. The allowlist. A 500 here is the specific regression that matters: it means the request fell
//    through to this build and hit the database binding that no longer exists.
console.log("\npaths the site must refuse");
for (const path of [
  "/api/v1/me",
  "/api/v1/ai/chat",
  "/api/v1/auth/google",
  "/api/v1/auth/admin-session",
  "/api/v1/slips/convert",
  "/api/v1/cron/daily-picks",
  "/api/v1/nonsense",
]) {
  const { res, err } = await get(`${SITE}${path}`);
  if (err) {
    record(path, false, String(err.message));
    continue;
  }
  record(path, res.status === 404, `${res.status}${res.status >= 500 ? "  <-- served here, not refused" : ""}`);
}

// 4. The redirects that were already in place, confirmed still in place.
console.log("\nredirects");
{
  const { res, err } = await get("https://www.gameclaw.win/pricing");
  record("www -> apex", !err && res.status === 308, err ? String(err.message) : `${res.status} -> ${res?.headers.get("location")}`);
}
for (const path of ["/chat", "/account", "/login/../chat", "/admin"]) {
  const { res, err } = await get(`${SITE}${path}`);
  const location = res?.headers.get("location");
  record(`${path} -> home`, !err && res.status === 302 && location === `${SITE}/`, err ? String(err.message) : `${res.status} -> ${location}`);
}

// 5. The API on its own, so a failure above can be attributed. If this is red the Worker is fine
//    and Render is not.
console.log("\nthe API directly (to attribute any failure above)");
{
  const { res, err, ms } = await get(`${API}/api/v1/health`);
  const body = err ? null : await res.json().catch(() => null);
  record("render /api/v1/health", !err && body?.data?.status === "ok", err ? String(err.message) : `${res.status} status=${body?.data?.status} in ${ms}ms`);
}

console.log(`\n${lines.join("\n")}`);

if (failures.length) {
  console.error(`\nFAILED\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nOK — pages serve, /api/v1 is answered by the API with a live database, and nothing else is forwarded.");
