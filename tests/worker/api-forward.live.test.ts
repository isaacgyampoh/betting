import { describe, expect, it } from "vitest";

/**
 * That every path in worker.ts's allowlist really exists on the Render API.
 *
 * api-forward.test.ts stubs upstream, which is right for asserting what the Worker sends - but it
 * means a typo in the allowlist passes. `/api/v1/picks/track_record` instead of `track-record`
 * would forward happily and return 404 to every visitor, and no stubbed test would notice. This
 * asks the real service.
 *
 * Off by default, because a unit suite that fails when a third party is slow teaches people to
 * ignore red. Run it before deploying the Worker:
 *
 *   GC_LIVE=1 pnpm vitest run tests/worker/api-forward.live.test.ts
 */
const RENDER = "https://gameclaw-api.onrender.com";
const live = process.env.GC_LIVE === "1";

// Kept in step with PROXIED in worker.ts by hand. A generated list would import the Worker, which
// drags in the OpenNext bundle; the duplication is three lines and this file exists to catch drift.
const PUBLIC_GETS = [
  "/api/v1/health",
  "/api/v1/matches",
  "/api/v1/competitions",
  "/api/v1/picks",
  "/api/v1/picks/track-record",
  "/api/v1/plans",
  "/api/v1/bookmakers",
  "/api/v1/bookmakers/catalogue",
];

describe.skipIf(!live)("the Render API answers every allowlisted path", () => {
  it.each(PUBLIC_GETS)("%s is a real route that returns JSON", async (path) => {
    const res = await fetch(`${RENDER}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });

    // 404 is the failure this file exists to catch: the path is wrong, not the service.
    expect(res.status, `${path} is not a route on the API`).not.toBe(404);
    expect(res.status, `${path} returned ${res.status}`).toBeLessThan(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toBeTypeOf("object");
  }, 70_000);

  it("reports a healthy database, which is the whole point of forwarding", async () => {
    const res = await fetch(`${RENDER}/api/v1/health`, { signal: AbortSignal.timeout(60_000) });
    const json = (await res.json()) as { data?: { status?: string } };
    expect(json.data?.status).toBe("ok");
  }, 70_000);

  // The webhook is POST-only and signature-checked, so it is probed rather than exercised: an
  // unsigned POST must be refused, and must be refused by the handler rather than by a 404.
  it("has the Paystack webhook mounted, and it rejects an unsigned post", async () => {
    const res = await fetch(`${RENDER}/api/v1/webhooks/paystack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(60_000),
    });
    expect(res.status, "the webhook route is missing").not.toBe(404);
    expect([400, 401, 403, 503]).toContain(res.status);
  }, 70_000);
});
