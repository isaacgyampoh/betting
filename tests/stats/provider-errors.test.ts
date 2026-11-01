import { describe, expect, it } from "vitest";
import { classifyApiFootballErrors } from "@/lib/stats/api-football";

/**
 * Reading what API-Football is actually complaining about.
 *
 * This file exists because of a production outage on 1 November 2026. `/api/v1/matches` answered
 * 503 all day on the website and the app, and today's daily pick never published, because the
 * account's daily request budget was spent - and nothing in the code looked at the field that says
 * so. The checks covered `plan` and `rateLimit`; the provider reports an exhausted day under
 * `requests`, with **HTTP 200**, so every path missed it and the request fell through to a generic
 * "something went wrong". The log said `stats.api_error` and nothing about quota, while the daily
 * ceiling that identifies the plan was already being captured from the response headers and never
 * read.
 *
 * A missing branch is invisible until something enumerates the cases, so this enumerates them.
 */
describe("the payload that caused the outage", () => {
  // Copied verbatim from the live response on 2026-11-01.
  const real = {
    requests: "You have reached the request limit for the day, Go to https://dashboard.api-football.com to upgrade your plan.",
  };

  it("is recognised as an exhausted daily budget", () => {
    expect(classifyApiFootballErrors(real)).toEqual({ kind: "quota", message: real.requests });
  });

  // The crux. The provider served this with 200, so any classification keyed on the HTTP status
  // could not have seen it - which is exactly what happened.
  it("is recognised even though the provider returned HTTP 200", () => {
    expect(classifyApiFootballErrors(real, 200).kind).toBe("quota");
  });

  it("is not mistaken for a momentary burst", () => {
    // A burst gets one short retry and a "try again in a minute" message. A spent day gets
    // neither, because neither helps until the provider's clock rolls over.
    expect(classifyApiFootballErrors(real).kind).not.toBe("rate");
  });
});

describe("a healthy response", () => {
  it("is ok when errors is the empty array the provider sends", () => {
    expect(classifyApiFootballErrors([])).toEqual({ kind: "ok" });
  });

  it("is ok when errors is absent", () => {
    expect(classifyApiFootballErrors(undefined)).toEqual({ kind: "ok" });
    expect(classifyApiFootballErrors(null)).toEqual({ kind: "ok" });
  });

  // An object with no keys carries no reason, so it is not a failure.
  it("is ok when errors is an empty object", () => {
    expect(classifyApiFootballErrors({})).toEqual({ kind: "ok" });
  });
});

describe("each reason the provider gives", () => {
  it("reads a refused key as auth", () => {
    const v = classifyApiFootballErrors({ token: "Missing application key" });
    expect(v).toEqual({ kind: "auth", message: "Missing application key" });
  });

  it("reads an excluded endpoint as a plan limit", () => {
    const v = classifyApiFootballErrors({ plan: "This endpoint is not available on your plan" });
    expect(v.kind).toBe("plan");
  });

  it("reads a burst refusal as a rate limit, keeping the provider's wording", () => {
    const v = classifyApiFootballErrors({ rateLimit: "Too many requests per minute" });
    expect(v).toEqual({ kind: "rate", message: "Too many requests per minute" });
  });

  it("reads a rate limit with a non-string value, without inventing a message", () => {
    expect(classifyApiFootballErrors({ rateLimit: true })).toEqual({ kind: "rate", message: undefined });
  });
});

describe("precedence, which is the part that is easy to get wrong", () => {
  // Nothing else means anything if we are not authenticated, so the key wins.
  it("puts a refused key ahead of everything else", () => {
    const v = classifyApiFootballErrors({ requests: "limit for the day", token: "bad key", plan: "nope" });
    expect(v.kind).toBe("auth");
  });

  // These two were conflated before, and they need opposite responses: wait a moment, or wait a day.
  it("puts an exhausted day ahead of a burst refusal", () => {
    const v = classifyApiFootballErrors({ rateLimit: "per minute", requests: "limit for the day" });
    expect(v.kind).toBe("quota");
  });

  it("puts an exhausted day ahead of a plan limit", () => {
    const v = classifyApiFootballErrors({ plan: "not on your plan", requests: "limit for the day" });
    expect(v.kind).toBe("quota");
  });
});

describe("what must not be read as a successful empty result", () => {
  // The caching trap. A 500 whose body parsed but listed no errors used to fall through to
  // `payload = body.response ?? []`, which caches an empty array - turning a provider fault into
  // "there are no matches today" for as long as the cache entry lives.
  it("treats an error status with no stated reason as an error", () => {
    expect(classifyApiFootballErrors([], 500)).toEqual({ kind: "error" });
    expect(classifyApiFootballErrors(undefined, 502)).toEqual({ kind: "error" });
  });

  it("treats a 4xx carrying a known reason as that reason, not a generic error", () => {
    // The old code threw on !res.ok before reading the body, so this arrived as "HTTP 403" with
    // the actionable sentence discarded.
    expect(classifyApiFootballErrors({ token: "invalid" }, 403).kind).toBe("auth");
    expect(classifyApiFootballErrors({ requests: "day limit" }, 429).kind).toBe("quota");
  });

  it("treats an unrecognised error field as an error rather than ignoring it", () => {
    expect(classifyApiFootballErrors({ somethingNew: "a reason we have not seen" })).toEqual({ kind: "error" });
  });

  it("does not treat a blank message as a reason", () => {
    // An empty or whitespace value is not a complaint; reading it as one would misreport a healthy
    // response as a refused key.
    expect(classifyApiFootballErrors({ token: "   " }).kind).not.toBe("auth");
    expect(classifyApiFootballErrors({ requests: "" }).kind).not.toBe("quota");
  });
});
