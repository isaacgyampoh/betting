// Custom Worker entry around the OpenNext build output (.open-next/worker.js, created by `pnpm cf:build`).
// Adds: www → apex redirect, app-only route redirects, the /api/v1 forwarder, and the Cron Triggers.
// .open-next/worker.js only exists after `pnpm cf:build`, so type-checking must pass with or without it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import handler from "./.open-next/worker.js";

type Env = { CRON_SECRET?: string; NEXT_PUBLIC_SITE_URL: string; CRON_TARGET_BASE?: string };

/**
 * Where the scheduled jobs actually run.
 *
 * They used to run here, in-process: `handler.fetch` against this Worker's own routes, which
 * meant they used this Worker's database connection. That connection is a Hyperdrive config
 * still pointing at a Supabase project that has been deleted, so every morning's run failed and
 * nothing published a daily pick between 17 and 20 October. The only trace was a `cron.triggered`
 * log line with a non-ok status, which nobody reads.
 *
 * The API on Render has its own database and is healthy, so the job is sent there over HTTPS
 * instead. That is also the better arrangement independently of the outage: a batch job that
 * writes to Postgres belongs next to Postgres, not at the edge.
 */
const CRON_TARGET = "https://gameclaw-api.onrender.com/api/v1";

/**
 * Routes that belong to the app, not to the marketing site.
 *
 * gameclaw.win signs nobody in. The web app's sign-in ran through a Supabase project that no
 * longer exists, so /chat and /account were still served here and still answered - as screens that
 * cannot load. A visitor who found one spent their attempt on a dead end.
 *
 * /login is deliberately NOT in this list, though it was. It was here because it served a Supabase
 * form that could not sign anybody in, and bouncing people home was better than that. The form is
 * gone: the page now says accounts live in the app and links to it. That is a better answer than a
 * redirect for somebody arriving on an old link, and it needs no session and no database.
 *
 * They are redirected rather than 404'd: the pages are reachable from old links and search
 * results, and the home page is a better answer than "not found" for someone looking for the
 * product. The code stays in the build because the same Next app serves the API on Render, where
 * these routes are legitimate.
 *
 * /admin is here for a different reason, and it is the one deliberate reduction in this change.
 * The dashboard authenticates with a `gc_admin_session` cookie and every one of its pages reads
 * Postgres directly from the server component, so none of it can work on this host - today
 * /admin/sign-in renders a Google button that returns 500 when pressed. Making it work here would
 * mean forwarding an administrator's session cookie to another origin for every page view, which
 * is a great deal of exposure for one operator's convenience. It already works on Render, which
 * has the database: https://gameclaw-api.onrender.com/admin
 */
const APP_ONLY = ["/chat", "/account", "/convert", "/slip", "/picks", "/matches", "/welcome", "/auth", "/admin"];

function isAppOnly(pathname: string): boolean {
  return APP_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The API, which this Worker forwards instead of serving.
 *
 * The same Next application runs here and on Render, so `/api/v1/*` exists in this build too - and
 * here it reaches for Postgres through a Hyperdrive binding that cannot connect, because
 * `gameclaw-db` accepts no external connections. That is why `gameclaw.win/api/v1/health` answered
 * 503 `database_unreachable` and `/api/v1/matches` answered 500, while the identical routes on
 * Render answered 200.
 *
 * Opening the database to Cloudflare was the alternative, and it is worse than it sounds:
 * Hyperdrive egresses from Cloudflare's shared ranges, used by every customer, so allowlisting
 * them is barely narrower than allowlisting the internet. Forwarding keeps the database closed and
 * leaves exactly one process talking to it.
 */
const API_ORIGIN = "https://gameclaw-api.onrender.com";

/**
 * Exactly what this host may ask the API for.
 *
 * An allowlist rather than a pass-through. The destination is a constant, so this was never an
 * open proxy in the classic sense - nobody can aim it at a host of their choosing - but a
 * pass-through would still have made gameclaw.win a second, unmonitored front door to every
 * endpoint, including the AI and the ones that spend money.
 *
 * The list is the public, unauthenticated surface, and that is not a coincidence: it is everything
 * this host actually has a caller for. The phone apps hold
 * `GC_API_BASE=https://gameclaw-api.onrender.com/api/v1` and talk to Render directly, so nothing
 * on a device depends on any of this. The website's own authenticated screens live under APP_ONLY
 * and are redirected before they can call anything.
 *
 * Left out on purpose:
 *
 *   * `/cron/*`. The scheduled handler below calls Render directly; these have no business being
 *     reachable over the internet on this hostname, CRON_SECRET or not.
 *   * everything needing a session - `/auth/*`, `/me/*`, `/ai/*`, `/slips/*`, `/follows/*`,
 *     `/devices/*`, `/push`, `/billing/*`. Allowing them would mean carrying account credentials
 *     across origins for callers that do not exist.
 */
const PROXIED: ReadonlyArray<{ path: RegExp; methods: readonly string[] }> = [
  // Public reads: no session, nothing per-person, and the same data the marketing pages already
  // render. HEAD alongside GET because uptime checks use it and Next serves it from the same route.
  { path: /^\/api\/v1\/health$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/matches$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/matches\/lookup$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/matches\/[^/]+$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/competitions$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/competitions\/[^/]+$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/teams\/[^/]+$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/picks$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/picks\/track-record$/, methods: ["GET", "HEAD"] },
  // Daily Special Picks. Public for the same reason the accumulator picks are: the selections are
  // a published claim and the record beside them is the evidence for it.
  { path: /^\/api\/v1\/special-picks$/, methods: ["GET", "HEAD"] },
  // One published slip by its public reference, which is what a shared link resolves to.
  { path: /^\/api\/v1\/special-picks\/[A-Za-z0-9-]+$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/plans$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/bookmakers$/, methods: ["GET", "HEAD"] },
  { path: /^\/api\/v1\/bookmakers\/catalogue$/, methods: ["GET", "HEAD"] },
  // Paystack posts here, to whatever URL is set in their dashboard - which this repository cannot
  // see, so the route stays reachable rather than being broken on an assumption. It is safe to
  // expose: the handler refuses anything whose x-paystack-signature does not verify.
  { path: /^\/api\/v1\/webhooks\/paystack$/, methods: ["POST"] },
];

function isProxied(pathname: string, method: string): boolean {
  return PROXIED.some((r) => r.path.test(pathname) && r.methods.includes(method));
}

/**
 * Headers that travel, and why the rest do not.
 *
 * `cf-connecting-ip` has to travel or the forwarding quietly breaks rate limiting: lib/request.ts
 * hashes that header first, so without it every visitor through this host would share one bucket -
 * one person tripping a limit would lock out everybody.
 *
 * `cookie` deliberately does not travel. Nothing in PROXIED reads one, and forwarding a browser's
 * cookies to a different origin is how a session ends up somewhere it was never scoped to.
 * `authorization` does not travel either, for the same reason in reverse: no allowed route reads
 * it, so forwarding it would only move a bearer token across origins for no benefit.
 *
 * `host`, `connection` and the other hop-by-hop headers are dropped because they describe this hop
 * and would misdirect the next one, and `x-forwarded-*` is dropped because a client can set it.
 */
const FORWARD_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "cf-connecting-ip",
  "x-paystack-signature",
];

/**
 * Response headers that are not re-sent.
 *
 * The first four describe the upstream connection rather than the body: passing on a
 * `content-length` or `content-encoding` measured against a body the runtime has already decoded is
 * how a truncated or unreadable response happens, and `set-cookie` is dropped because nothing in
 * PROXIED sets one and a cookie landing on this origin would land next to the admin session.
 *
 * The last two are Render's own: `x-render-origin-server` and the `rndr-id` request id were
 * reaching browsers and naming the infrastructure behind the site. Not credentials, and not a
 * vulnerability, but they are somebody else's internal detail arriving under our hostname, and the
 * forwarder is the right place to stop them.
 */
const DROP_RESPONSE_HEADERS = [
  "set-cookie",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "x-render-origin-server",
  "rndr-id",
];

/**
 * The error body, in the shape lib/api.ts `fail()` produces.
 *
 * Deliberately reusing existing codes from lib/errors.ts rather than inventing an
 * `UPSTREAM_UNAVAILABLE`: that file opens by saying the codes are part of the public API contract,
 * and a client switching on them should not meet a code that only this file knows about.
 */
function errorBody(code: "NOT_FOUND" | "INTERNAL", message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function forwardToApi(request: Request, url: URL): Promise<Response> {
  const target = `${API_ORIGIN}${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Buffered rather than streamed. Only the Paystack webhook has a body here, and its signature is
  // computed over the exact bytes - buffering guarantees they arrive unchanged, and sidesteps the
  // half-duplex streaming dance a passed-through ReadableStream would need.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // manual, so a redirect from the API is reported to the caller as a redirect rather than
      // being silently followed here.
      redirect: "manual",
      // Render's starter plan does not idle, so there is no cold start to wait out; everything in
      // PROXIED is a cheap read. Long enough to ride out a deploy, short enough that a hung
      // upstream does not hold a visitor's browser open.
      signal: AbortSignal.timeout(30_000),
    });

    // Rebuilt rather than reused, so nothing upstream can set a cookie on this origin.
    const out = new Headers();
    for (const [key, value] of upstream.headers) {
      if (!DROP_RESPONSE_HEADERS.includes(key.toLowerCase())) out.set(key, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.log(JSON.stringify({
      level: "error",
      msg: timedOut ? "api_forward.timeout" : "api_forward.unreachable",
      target,
      err: err instanceof Error ? err.message : String(err),
    }));
    return errorBody(
      "INTERNAL",
      timedOut ? "That took too long. Please try again." : "Something went wrong. Please try again.",
      timedOut ? 504 : 502,
    );
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === "www.gameclaw.win") {
      url.hostname = "gameclaw.win";
      return Response.redirect(url.toString(), 308);
    }
    // 302, not 308: this is a statement about what this deployment currently serves, not a
    // permanent claim about the URL. A browser that cached a 308 would keep redirecting even
    // after the app comes back.
    if (isAppOnly(url.pathname)) {
      return Response.redirect(new URL("/", url).toString(), 302);
    }
    // Ahead of the Next handler, so no API request can reach the unusable database binding. A path
    // under /api/v1 that is not allowlisted stops here too - falling through would serve it from
    // this build, which is the broken behaviour being removed.
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      return isProxied(url.pathname, request.method)
        ? forwardToApi(request, url)
        : errorBody("NOT_FOUND", "Not found.", 404);
    }
    return handler.fetch(request, env, ctx);
  },

  // Cron Triggers: 03:30 GMT prunes caches, 07:00 GMT publishes and settles the daily picks.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const path = controller.cron === "0 7 * * *" ? "/cron/daily-picks" : "/cron/cleanup";
    const base = env.CRON_TARGET_BASE ?? CRON_TARGET;
    ctx.waitUntil(
      // GET, because that is what both cron routes export. A POST returns 405 and would look
      // exactly like a job that ran and did nothing.
      fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
        signal: AbortSignal.timeout(120_000),
      })
        .then(async (res: Response) => {
          // The body matters on failure: a 401 here means this Worker's CRON_SECRET and the API's
          // have drifted apart, which looks identical to a broken job from the outside.
          console.log(JSON.stringify({
            level: res.ok ? "info" : "error",
            msg: "cron.triggered",
            target: `${base}${path}`,
            status: res.status,
            body: (await res.text()).slice(0, 500),
          }));
        })
        .catch((err: unknown) => {
          console.log(JSON.stringify({
            level: "error",
            msg: "cron.unreachable",
            target: `${base}${path}`,
            err: err instanceof Error ? err.message : String(err),
          }));
        }),
    );
  },
};

export default worker;
