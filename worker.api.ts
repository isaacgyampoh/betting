// Entry point for the dedicated API Worker (`gameclaw-api`), which serves the mobile app.
//
// Deliberately NOT worker.ts. Two differences, and both matter:
//
//  1. No `scheduled` handler. The Cron Triggers that publish and settle the daily picks live on
//     the website Worker and must stay there. A second Worker declaring the same crons would
//     publish every day's picks twice and settle them twice, against a record whose whole value
//     is that it is never edited after the fact.
//
//  2. Only /api/* is served. Everything else is refused rather than rendered. This Worker exists
//     for the Flutter app; serving the website from a second hostname would put a second copy of
//     the site on the internet with its own URL, which nobody asked for and which would compete
//     with the real one in search.
//
// .open-next/worker.js only exists after a build, so type-checking must pass with or without it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import handler from "./.open-next/worker.js";

type Env = Record<string, unknown>;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // A plain health word at the root, so hitting the hostname in a browser says what this is
    // rather than returning a 404 that looks like a broken deploy.
    if (url.pathname === "/") {
      return Response.json(
        { data: { service: "gameclaw-api", docs: "/api/v1/health" } },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // Two families of route must never run on this Worker, and neither is blocked by accident:
    //
    //  * /api/v1/cron/* publishes and settles the daily picks. Those run on the website Worker's
    //    Cron Triggers. Reachable here, they would let a second caller settle a published record
    //    that is meant never to be edited after the fact.
    //  * /api/v1/webhooks/* is Paystack settling payments. Paystack is configured to deliver to
    //    the website, and a payment handled twice is a real-money mistake.
    //
    // Neither has its secret set here either, so both would already fail - but failing because a
    // secret is missing is an accident, and this is a decision.
    if (url.pathname.startsWith("/api/v1/cron/") || url.pathname.startsWith("/api/v1/webhooks/")) {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Not served on the API host." } },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    if (!url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "This host serves the GameClaw API only." } },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
