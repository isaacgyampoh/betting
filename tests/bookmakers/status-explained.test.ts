import { describe, expect, it } from "vitest";
import { AWAITING_SETUP, REFUSED_BY_BOOKMAKER } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";

/**
 * No bookmaker reaches a user as a bare status with nothing to explain it.
 *
 * Four states mean four different things and only one of them is ours to fix, so collapsing them
 * into an undifferentiated "not yet" sends somebody holding a perfectly valid code looking for a
 * fault at their end.
 *
 * Where the reason differs between bookmakers it is carried per bookmaker, in these two maps, and
 * the convert screen prints one line each. Where it is identical for everyone in a state - which
 * is true of `unsupported`, meaning only "we have found no authorised integration" - the screen
 * prints one sentence for the state instead. This test guards the first kind: a bookmaker that is
 * refused or awaiting setup has a specific reason, because for those the generic sentence would
 * be wrong.
 *
 * That a refused bookmaker is also genuinely unbookable - capabilities zeroed, every call
 * rejected - is covered under production settings in sample-data-guard.test.ts, which is where
 * the environment is stubbed properly. Asserting it here instead passes a mock adapter in a dev
 * environment and proves nothing.
 */
describe("a bookmaker that cannot be converted to explains itself", () => {
  it("gives a specific reason for every bookmaker that is refused or awaiting setup", () => {
    for (const slug of Object.keys(REFUSED_BY_BOOKMAKER)) {
      expect(REFUSED_BY_BOOKMAKER[slug as never], slug).toBeTruthy();
    }
    for (const slug of Object.keys(AWAITING_SETUP)) {
      expect(AWAITING_SETUP[slug as never], slug).toBeTruthy();
    }
  });

  it("never puts the same bookmaker in both maps, which would make the note depend on lookup order", () => {
    for (const slug of BOOKMAKER_SLUGS) {
      const both = Boolean(REFUSED_BY_BOOKMAKER[slug]) && Boolean(AWAITING_SETUP[slug]);
      expect(both, `${slug} is explained twice`).toBe(false);
    }
  });

  it("does not tell anyone to wait for something that needs an agreement, not patience", () => {
    for (const reason of [...Object.values(REFUSED_BY_BOOKMAKER), ...Object.values(AWAITING_SETUP)]) {
      expect(reason!.toLowerCase()).not.toContain("coming soon");
      expect(reason!.toLowerCase()).not.toContain("shortly");
    }
  });

  it("keeps MSport listed as refused rather than unsupported, because the integration is finished", () => {
    // It reads as "their servers are turning us away", not "we never built it" - the distinction
    // the refusal map exists for. Verified again on 18 Oct 2026: Cloudflare answers 403.
    expect(REFUSED_BY_BOOKMAKER.msport).toBeTruthy();
    expect(AWAITING_SETUP.msport).toBeUndefined();
  });
});
