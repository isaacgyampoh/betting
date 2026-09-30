// Custom Worker entry around the OpenNext build output (.open-next/worker.js, created by `pnpm cf:build`).
// Adds: www → apex redirect, and the daily cleanup Cron Trigger.
// .open-next/worker.js only exists after `pnpm cf:build`, so type-checking must pass with or without it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import handler from "./.open-next/worker.js";

type Env = { CRON_SECRET?: string; NEXT_PUBLIC_SITE_URL: string };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === "www.gameclaw.win") {
      url.hostname = "gameclaw.win";
      return Response.redirect(url.toString(), 308);
    }
    return handler.fetch(request, env, ctx);
  },

  // Runs the same protected route Vercel Cron used to call, with the shared secret.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const request = new Request(`${env.NEXT_PUBLIC_SITE_URL}/api/v1/cron/cleanup`, {
      headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });
    ctx.waitUntil(
      handler.fetch(request, env, ctx).then(async (res: Response) => {
        console.log(JSON.stringify({ level: res.ok ? "info" : "error", msg: "cron.cleanup_triggered", status: res.status, body: await res.text() }));
      }),
    );
  },
};

export default worker;
