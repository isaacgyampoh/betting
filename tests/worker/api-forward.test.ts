import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/worker";

/**
 * What gameclaw.win does with a request for /api/v1.
 *
 * The Worker and the Render service run the same Next application, but only Render can reach
 * Postgres - `gameclaw-db` accepts no external connections and the Worker's Hyperdrive binding
 * pointed at a Supabase project that no longer exists. So every API route answered 500 or 503 on
 * the website while answering correctly on Render. worker.ts now forwards an allowlisted subset
 * instead of serving it.
 *
 * These tests drive the real `worker.fetch`, not an extracted helper, because the defect being
 * guarded against is one of *order*: a forwarder placed after the Next handler, or after the
 * APP_ONLY redirects, looks identical in isolation and does nothing in production. The OpenNext
 * bundle is stubbed (tests/stubs/open-next-worker.ts) and answers "reached the next handler", so
 * every test can tell being answered here from falling through.
 *
 * Upstream is a stub too: these assert what the Worker *sends* and how it treats what comes back.
 * tests/worker/api-forward.live.test.ts does the same against the real Render service.
 */
type Env = Parameters<typeof worker.fetch>[1];
type Ctx = Parameters<typeof worker.fetch>[2];

const env = { NEXT_PUBLIC_SITE_URL: "https://gameclaw.win" } as Env;
const ctx = { waitUntil: () => {} } as unknown as Ctx;

const RENDER = "https://gameclaw-api.onrender.com";

type Call = { url: string; method: string; headers: Headers; body: ArrayBuffer | undefined };
let calls: Call[];
let reply: () => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  reply = () => new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit | undefined) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as HeadersInit),
      body: init?.body as ArrayBuffer | undefined,
    });
    return reply();
  });
});

function hit(path: string, init?: RequestInit, host = "gameclaw.win") {
  return worker.fetch(new Request(`https://${host}${path}`, init), env, ctx);
}

const body = async (res: Response) => JSON.parse(await res.text());

describe("the routes gameclaw.win forwards", () => {
  it("sends a public read to Render, keeping the path and the query string", async () => {
    const res = await hit("/api/v1/matches?date=2026-10-31&limit=20");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RENDER}/api/v1/matches?date=2026-10-31&limit=20`);
    expect(calls[0].method).toBe("GET");
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ data: { ok: true } });
  });

  it("forwards every endpoint the marketing site and an uptime check depend on", async () => {
    const paths = [
      "/api/v1/health",
      "/api/v1/matches",
      "/api/v1/matches/lookup?code=ABC123",
      "/api/v1/matches/abc-123",
      "/api/v1/competitions",
      "/api/v1/competitions/39",
      "/api/v1/teams/42",
      "/api/v1/picks",
      "/api/v1/picks/track-record",
      "/api/v1/plans",
      "/api/v1/bookmakers",
      "/api/v1/bookmakers/catalogue",
    ];
    for (const path of paths) {
      calls = [];
      const res = await hit(path);
      expect(calls.map((c) => c.url), `${path} should forward`).toEqual([`${RENDER}${path}`]);
      expect(res.status, path).toBe(200);
    }
  });

  it("answers HEAD as well as GET, which is what uptime checks send", async () => {
    const res = await hit("/api/v1/health", { method: "HEAD" });
    expect(calls[0].method).toBe("HEAD");
    expect(calls[0].body).toBeUndefined();
    expect(res.status).toBe(200);
  });

  // The signature is computed over the exact bytes, so a webhook that arrives re-encoded verifies
  // as a forgery and a real payment is dropped.
  it("forwards the Paystack webhook byte for byte, with its signature", async () => {
    const raw = '{"event":"charge.success","data":{"reference":"abc"}}';
    const res = await hit("/api/v1/webhooks/paystack", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", "x-paystack-signature": "deadbeef" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RENDER}/api/v1/webhooks/paystack`);
    expect(calls[0].method).toBe("POST");
    expect(new TextDecoder().decode(calls[0].body)).toBe(raw);
    expect(calls[0].headers.get("x-paystack-signature")).toBe("deadbeef");
    expect(res.status).toBe(200);
  });
});

describe("the routes gameclaw.win refuses", () => {
  const refused = [
    // Need a session. The phone apps hold the Render base URL and never come through this host.
    "/api/v1/me",
    "/api/v1/me/referral",
    "/api/v1/ai/chat",
    "/api/v1/ai/allowance",
    "/api/v1/auth/google",
    "/api/v1/auth/apple",
    "/api/v1/auth/refresh",
    "/api/v1/auth/admin-session",
    "/api/v1/slips",
    "/api/v1/slips/convert",
    "/api/v1/follows",
    "/api/v1/devices",
    "/api/v1/push",
    "/api/v1/billing/checkout",
    // Driven by the scheduled handler straight to Render; nothing should reach them over HTTP here.
    "/api/v1/cron/cleanup",
    "/api/v1/cron/daily-picks",
    "/api/v1/cron/match-alerts",
    // Real routes, but not on the list.
    "/api/v1/matches/abc/analysis",
    "/api/v1/slips/abc/book",
    // Not routes at all.
    "/api/v1",
    "/api/v1/",
    "/api/v1/nonsense",
  ];

  it("answers 404 without contacting Render", async () => {
    for (const path of refused) {
      calls = [];
      const res = await hit(path);
      expect(res.status, `${path} should be refused`).toBe(404);
      expect(calls, `${path} must not be forwarded`).toHaveLength(0);
    }
  });

  // The failure that would make the allowlist pointless: falling through to the Next handler, which
  // is the build with the unusable database binding - the 500s this change exists to remove.
  it("does not fall through to the Next handler", async () => {
    for (const path of refused) {
      const res = await hit(path);
      expect(await res.text(), path).not.toContain("reached the next handler");
    }
  });

  it("refuses a method that the allowlisted path does not offer", async () => {
    const cases: [string, string][] = [
      ["/api/v1/health", "POST"],
      ["/api/v1/health", "DELETE"],
      ["/api/v1/matches", "POST"],
      ["/api/v1/matches/abc-123", "DELETE"],
      ["/api/v1/plans", "PUT"],
      ["/api/v1/bookmakers", "PATCH"],
      // The webhook is POST-only: a GET must not reach it.
      ["/api/v1/webhooks/paystack", "GET"],
    ];
    for (const [path, method] of cases) {
      calls = [];
      const init = method === "GET" || method === "HEAD" ? { method } : { method, body: "{}" };
      const res = await hit(path, init);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(calls, `${method} ${path} must not be forwarded`).toHaveLength(0);
    }
  });

  it("reports the refusal in the error shape the API itself uses", async () => {
    const res = await hit("/api/v1/ai/chat", { method: "POST", body: "{}" });
    expect(res.headers.get("content-type")).toContain("application/json");
    // lib/errors.ts opens by saying the codes are a public contract, so this reuses one rather
    // than inventing a code only the Worker knows.
    expect(await body(res)).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });
});

describe("it cannot be turned into an open proxy", () => {
  // The destination is a constant, so there is no parameter to point elsewhere. This pins that: no
  // crafted path, however it is escaped, results in a request to a host other than Render.
  it("never contacts a host other than the Render API, whatever the path", async () => {
    const crafted = [
      "/api/v1/matches/..%2f..%2fadmin",
      "/api/v1/matches/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/api/v1/matches/http://evil.example",
      "/api/v1/matches/https:%2f%2fevil.example",
      "/api/v1/health/../../../admin",
      "/api/v1//evil.example/path",
      "/api/v1/matches?next=https://evil.example",
      "/api/v1/matches/abc%00",
      "/api/v1/matches/%2F%2Fevil.example",
    ];
    for (const path of crafted) {
      calls = [];
      await hit(path);
      for (const call of calls) {
        expect(new URL(call.url).origin, `${path} changed the destination`).toBe(RENDER);
      }
    }
  });

  it("ignores a header asking it to forward somewhere else", async () => {
    await hit("/api/v1/health", {
      headers: {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
        forwarded: "host=evil.example",
      },
    });
    expect(new URL(calls[0].url).origin).toBe(RENDER);
    expect(calls[0].headers.get("x-forwarded-host")).toBeNull();
    expect(calls[0].headers.get("forwarded")).toBeNull();
  });
});

describe("what it does and does not carry across origins", () => {
  it("does not forward the browser's cookies", async () => {
    await hit("/api/v1/health", {
      headers: { cookie: "gc_admin_session=a-real-session-token; other=1" },
    });
    expect(calls[0].headers.get("cookie")).toBeNull();
    // Nor smuggled under another name.
    expect([...calls[0].headers.keys()]).not.toContain("cookie");
    expect(JSON.stringify([...calls[0].headers])).not.toContain("a-real-session-token");
  });

  it("does not forward an Authorization header", async () => {
    await hit("/api/v1/health", { headers: { authorization: "Bearer a-real-access-token" } });
    expect(calls[0].headers.get("authorization")).toBeNull();
    expect(JSON.stringify([...calls[0].headers])).not.toContain("a-real-access-token");
  });

  // Without this the forwarding silently breaks rate limiting: lib/request.ts hashes
  // cf-connecting-ip first, so every visitor through this host would share one bucket and one
  // person tripping a limit would lock out everybody.
  it("passes the real caller's IP so rate limits stay per-person", async () => {
    await hit("/api/v1/health", { headers: { "cf-connecting-ip": "41.66.1.9" } });
    expect(calls[0].headers.get("cf-connecting-ip")).toBe("41.66.1.9");
  });

  it("passes content negotiation and the user agent, so logs and formats are unchanged", async () => {
    await hit("/api/v1/matches", {
      headers: { accept: "application/json", "accept-language": "en-GB", "user-agent": "Firefox/1" },
    });
    expect(calls[0].headers.get("accept")).toBe("application/json");
    expect(calls[0].headers.get("accept-language")).toBe("en-GB");
    expect(calls[0].headers.get("user-agent")).toBe("Firefox/1");
  });

  it("sends no Cloudflare internals beyond the caller's IP", async () => {
    await hit("/api/v1/health", {
      headers: { "cf-connecting-ip": "41.66.1.9", "cf-ray": "abc", "cf-ipcountry": "GH" },
    });
    const sent = [...calls[0].headers.keys()].filter((k) => k.startsWith("cf-"));
    expect(sent).toEqual(["cf-connecting-ip"]);
  });
});

describe("what it does with Render's answer", () => {
  it("preserves the status, the body and the content type exactly", async () => {
    for (const status of [200, 201, 400, 401, 404, 422, 429, 500, 503]) {
      calls = [];
      reply = () => new Response(JSON.stringify({ error: { code: "X", message: "m" } }), {
        status,
        headers: { "content-type": "application/json", "x-request-id": "r1" },
      });
      const res = await hit("/api/v1/matches");
      expect(res.status, `status ${status}`).toBe(status);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("x-request-id")).toBe("r1");
      expect(await body(res)).toEqual({ error: { code: "X", message: "m" } });
    }
  });

  it("passes caching instructions through rather than deciding for the API", async () => {
    reply = () => new Response("{}", { headers: { "cache-control": "public, max-age=60" } });
    const res = await hit("/api/v1/matches");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  // Nothing on the list sets a cookie, so one arriving means something unexpected happened. It
  // would land on the gameclaw.win origin, where the admin session cookie also lives.
  it("refuses to set a cookie on this origin on Render's behalf", async () => {
    reply = () => new Response("{}", { headers: { "set-cookie": "gc_admin_session=x; Path=/" } });
    const res = await hit("/api/v1/health");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("drops the hop-by-hop headers that describe Render's connection, not the body", async () => {
    reply = () => new Response("{}", {
      headers: { "content-encoding": "gzip", "content-length": "999", "transfer-encoding": "chunked" },
    });
    const res = await hit("/api/v1/health");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBeNull();
    // The body must still be readable - a stale content-length is how a truncated response happens.
    expect(await res.text()).toBe("{}");
  });

  it("reports an unreachable API as 502 rather than pretending there is no data", async () => {
    reply = () => { throw new TypeError("network error"); };
    const res = await hit("/api/v1/matches");
    expect(res.status).toBe(502);
    expect((await body(res)).error.code).toBe("INTERNAL");
  });

  it("reports a timeout as 504", async () => {
    reply = () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    const res = await hit("/api/v1/matches");
    expect(res.status).toBe(504);
    const parsed = await body(res);
    expect(parsed.error.code).toBe("INTERNAL");
    expect(parsed.error.message).toMatch(/too long/i);
  });

  it("never leaks the upstream URL or an internal message to the caller", async () => {
    reply = () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 user=gameclaw"); };
    const res = await hit("/api/v1/matches");
    const text = await res.text();
    expect(text).not.toContain("onrender.com");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("gameclaw");
  });
});

describe("the rest of the Worker still behaves", () => {
  it("still sends www to the apex, before anything else", async () => {
    const res = await hit("/api/v1/health", undefined, "www.gameclaw.win");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://gameclaw.win/api/v1/health");
    expect(calls).toHaveLength(0);
  });

  it("still redirects the app-only routes home", async () => {
    for (const path of ["/chat", "/login", "/account", "/convert", "/slip/abc", "/welcome", "/auth/callback"]) {
      const res = await hit(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe("https://gameclaw.win/");
    }
  });

  // The dashboard authenticates with a cookie and reads Postgres from its server components, so it
  // cannot work on this host. It does work on Render, which has the database.
  it("redirects the admin dashboard rather than serving a sign-in that cannot work", async () => {
    for (const path of ["/admin", "/admin/sign-in", "/admin/users"]) {
      const res = await hit(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe("https://gameclaw.win/");
    }
  });

  it("still serves the marketing pages from this build", async () => {
    for (const path of ["/", "/pricing", "/support", "/track-record"]) {
      const res = await hit(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain("reached the next handler");
      expect(calls, `${path} is served here, not forwarded`).toHaveLength(0);
    }
  });

  it("does not forward anything under /api that is not /api/v1", async () => {
    for (const path of ["/api", "/api/v2/matches", "/api/health"]) {
      calls = [];
      const res = await hit(path);
      expect(calls, path).toHaveLength(0);
      expect(await res.text(), path).toContain("reached the next handler");
    }
  });
});
