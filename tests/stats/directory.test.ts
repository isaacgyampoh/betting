import { describe, expect, it } from "vitest";
import { listCompetitions } from "@/lib/services/directory";
import { sampleStatsProvider } from "@/lib/stats/sample";

// The sample provider, so these exercise the filtering rather than the environment. The live
// catalogue's own shape is covered by the provider audit in match-statistics.test.ts.
const provider = sampleStatsProvider;

/**
 * The catalogue is about 1,250 competitions across 171 countries in a single provider response.
 * These pin the filtering that makes that usable on a phone, and the one rule that matters about
 * ordering: no country is promoted over another.
 */
describe("the competition directory", () => {
  it("lists countries with a count each", async () => {
    const { countries } = await listCompetitions({ provider });
    expect(countries.length).toBeGreaterThan(0);
    expect(countries.every((c) => c.name.length > 0)).toBe(true);
    expect(countries.every((c) => c.competitions > 0)).toBe(true);
  });

  it("sorts countries alphabetically, with none promoted", async () => {
    const { countries } = await listCompetitions({ provider });
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("filters by country", async () => {
    const { countries } = await listCompetitions({ provider });
    const target = countries[0].name;
    const { competitions } = await listCompetitions({ provider, country: target });
    expect(competitions.length).toBeGreaterThan(0);
    expect(competitions.every((c) => c.country === target)).toBe(true);
  });

  it("searches names and countries alike", async () => {
    const { competitions: all } = await listCompetitions({ provider, limit: 200 });
    const needle = all[0].name.slice(0, 4).toLowerCase();
    const { competitions } = await listCompetitions({ provider, search: needle });
    expect(
      competitions.every(
        (c) => c.name.toLowerCase().includes(needle) || c.country.toLowerCase().includes(needle),
      ),
    ).toBe(true);
  });

  it("reports the total before paging, so a trimmed list can say so", async () => {
    const page = await listCompetitions({ provider, limit: 1 });
    expect(page.competitions).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(page.competitions.length);
  });

  it("pages without repeating or skipping", async () => {
    const first = await listCompetitions({ provider, limit: 2, offset: 0 });
    const second = await listCompetitions({ provider, limit: 2, offset: 2 });
    const ids = new Set([...first.competitions, ...second.competitions].map((c) => c.id));
    expect(ids.size).toBe(first.competitions.length + second.competitions.length);
  });

  it("returns nothing rather than everything for a search that matches nothing", async () => {
    const { competitions } = await listCompetitions({ provider, search: "zzzzz-no-such-competition" });
    expect(competitions).toHaveLength(0);
  });

  it("carries each competition's own coverage, so a page knows what it can show", async () => {
    const { competitions } = await listCompetitions({ provider, limit: 5 });
    // Coverage may be null when the provider gives no season, which is itself a fact the page
    // has to handle - but the field must be present either way.
    expect(competitions.every((c) => "coverage" in c)).toBe(true);
  });
});
