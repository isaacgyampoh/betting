import { describe, expect, it } from "vitest";
import {
  allEntries,
  coverage,
  destinations,
  directions,
  entryById,
  sources,
  INTEGRATION_STATUSES,
} from "@/lib/bookmakers/catalogue";
import { getAdapter } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";

/**
 * The catalogue's job is to be believed.
 *
 * It is research, and research about betting operators is the kind that gets quoted in a pitch
 * deck a quarter later. So the tests here are mostly about what it must never say: that an
 * operator can issue a code when no adapter can, that something is live-verified without
 * evidence, or that there are more working conversion directions than there are working
 * integrations to make them from.
 */
describe("the operator catalogue", () => {
  const entries = allEntries();

  it("gives every entry a stable, unique id of brand-country", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size, "duplicate ids").toBe(ids.length);
    for (const e of entries) {
      expect(e.id, `${e.id} should end with its country`).toMatch(
        new RegExp(`-${e.country.toLowerCase()}$`),
      );
    }
  });

  it("uses only the declared statuses", () => {
    for (const e of entries) {
      expect(INTEGRATION_STATUSES, e.id).toContain(e.status);
    }
  });

  it("treats a brand in two markets as two entries", () => {
    // Different fixtures, odds, markets and often a different code format. Collapsing them would
    // let a Kenyan code be offered against Ghanaian prices.
    const sportybet = entries.filter((e) => e.brand === "SportyBet");
    expect(sportybet.length).toBeGreaterThan(1);
    expect(new Set(sportybet.map((e) => e.country)).size).toBe(sportybet.length);
  });

  describe("what it is allowed to promise", () => {
    it("claims no capability without an adapter behind it", () => {
      for (const e of entries) {
        if (e.capabilities.readsCodes || e.capabilities.issuesCodes) {
          expect(e.adapter, `${e.id} claims a capability with no adapter`).toBeTruthy();
        }
      }
    });

    it("only names adapters that actually exist", () => {
      for (const e of entries) {
        if (e.adapter) expect(BOOKMAKER_SLUGS, e.id).toContain(e.adapter);
      }
    });

    it("backs every live-verified entry with a real adapter and a dated reason", () => {
      const live = entries.filter((e) => e.status === "live-verified");
      expect(live.length, "something should be verified").toBeGreaterThan(0);
      for (const e of live) {
        expect(e.adapter, `${e.id} is live-verified with no adapter`).toBeTruthy();
        expect(e.reason, `${e.id} is live-verified with no evidence`).toBeTruthy();
        expect(e.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("explains every entry a user could be refused by", () => {
      for (const e of entries) {
        if (e.status === "unavailable" || e.status === "awaiting-authorisation") {
          expect(e.reason, `${e.id} refuses the user without saying why`).toBeTruthy();
        }
      }
    });

    it("never promises something is coming", () => {
      for (const e of entries) {
        expect((e.reason ?? "").toLowerCase()).not.toContain("coming soon");
      }
    });
  });

  describe("presence evidence", () => {
    it("records a real HTTP status wherever it claims a site answered", () => {
      for (const e of entries) {
        if (e.presence.kind === "site-reachable") {
          expect(e.presence.httpStatus, e.id).toBeGreaterThanOrEqual(200);
          expect(e.presence.httpStatus, e.id).toBeLessThan(300);
        }
        if (e.presence.kind === "site-blocked") {
          expect(e.presence.httpStatus, e.id).toBeGreaterThanOrEqual(400);
        }
      }
    });

    it("asserts a licence for nobody", () => {
      // The registers were not reachable and the secondary sources contradict each other, so the
      // catalogue names regulators and claims no licences. If a `licensed` field ever appears,
      // this test should be the thing that stops it.
      for (const e of entries) {
        expect(Object.keys(e)).not.toContain("licensed");
        expect(Object.keys(e)).not.toContain("licenceStatus");
      }
    });

    it("never treats a failed probe as evidence the operator is absent", () => {
      // The defect this is here for: the first catalogue called these `no-host` and reasoned "the
      // brand may not serve this market". Four of those hosts resolve perfectly well at an
      // address we had not guessed. A probe failure is a fact about our URL, not the operator.
      for (const e of entries) {
        if (e.presence.kind !== "unconfirmed") continue;
        const text = `${e.reason ?? ""} ${e.presence.note}`.toLowerCase();
        for (const claim of ["does not serve", "not serve this market", "no presence", "absent from"]) {
          expect(text, `${e.id} infers absence from a failed probe`).not.toContain(claim);
        }
        expect(e.presence.note.length, `${e.id} needs to say what was actually checked`).toBeGreaterThan(20);
      }
    });

    it("claims no capability for an operator whose address is unconfirmed", () => {
      for (const e of entries) {
        if (e.presence.kind !== "unconfirmed") continue;
        expect(e.capabilities.readsCodes, e.id).toBe(false);
        expect(e.capabilities.issuesCodes, e.id).toBe(false);
        expect(e.status, `${e.id} cannot be verified without a confirmed address`).not.toBe(
          "live-verified",
        );
      }
    });

    it("dates every piece of evidence", () => {
      for (const e of entries) {
        expect(e.presence.checkedAt, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe("conversion directions", () => {
    it("counts directions from what both sides can really do", () => {
      const s = sources().length;
      const d = destinations().length;
      // Every usable source paired with every usable destination, minus the self-pairs.
      const expected = s * d - sources().filter((f) => destinations().some((t) => t.id === f.id)).length;
      expect(directions().length).toBe(expected);
    });

    it("never offers a slip back to the bookmaker it came from", () => {
      for (const dir of directions()) expect(dir.from).not.toBe(dir.to);
    });

    it("does not multiply the whole catalogue into imaginary directions", () => {
      // The failure this guards against: quoting 95 operators as thousands of directions. A
      // direction needs two working integrations, not two names.
      expect(directions().length).toBeLessThanOrEqual(entries.length);
    });
  });

  describe("agreement with the adapters", () => {
    it("never says a bookmaker issues codes when the registry refuses to", () => {
      for (const e of entries) {
        if (!e.adapter || !e.capabilities.issuesCodes) continue;
        // In production the registry zeroes an unconnected adapter; here we only check that the
        // adapter itself declares the capability the catalogue advertises.
        expect(getAdapter(e.adapter).capabilities.createCode, `${e.id} oversells its adapter`).toBe(
          true,
        );
      }
    });
  });

  describe("the numbers", () => {
    it("computes coverage rather than restating it", () => {
      const c = coverage();
      expect(c.entries).toBe(entries.length);
      expect(c.countries).toBeGreaterThan(15);
      expect(Object.values(c.byStatus).reduce((a, b) => a + b, 0)).toBe(entries.length);
    });

    it("finds the two Ghana integrations that are really verified", () => {
      expect(entryById("sportybet-gh")?.status).toBe("live-verified");
      expect(entryById("footballcom-gh")?.status).toBe("live-verified");
    });

    it("keeps MSport unavailable rather than merely unfinished", () => {
      expect(entryById("msport-gh")?.status).toBe("unavailable");
    });
  });
});
