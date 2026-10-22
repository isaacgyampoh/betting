// Custom Worker entry around the OpenNext build output (.open-next/worker.js, created by `pnpm cf:build`).
// Adds: www → apex redirect, and the daily cleanup Cron Trigger.
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
 * longer exists, so /chat, /login and /account were still served here and still answered - with a
 * sign-in form that cannot work. A visitor who found one spent their attempt on a dead end.
 *
 * They are redirected rather than 404'd: the pages are reachable from old links and search
 * results, and the home page is a better answer than "not found" for someone looking for the
 * product. The code stays in the build because the same Next app serves the API on Render, where
 * these routes are legitimate.
 */
const APP_ONLY = ["/chat", "/login", "/account", "/convert", "/slip", "/picks", "/matches", "/welcome", "/auth"];

function isAppOnly(pathname: string): boolean {
  return APP_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
