import { createHash, randomInt } from "node:crypto";
import { AppError } from "@/lib/errors";
import { mapOrLog } from "@/lib/bookmakers/map";
import { derivePrices, FIXTURES, mockKickoff, type MockFixture, type MockPrices } from "@/lib/bookmakers/mock/fixtures";
import { teamSimilarity } from "@/lib/matching/similarity";
import type { Market } from "@/lib/markets/types";
import type {
  BookmakerAdapter,
  BookmakerEventInfo,
  BookmakerSlug,
  CreateCodeSelection,
  CreatedCode,
  EventMarkets,
  LoadedSlip,
  RawMarket,
} from "@/lib/bookmakers/types";

export type RawOffer = { raw: RawMarket; odds: number };

/** A pick inside a mock booking code: either an internal market or a raw one (to simulate unknown markets). */
export type MockPick = { fixture: string; market: Market } | { fixture: string; raw: RawMarket; odds: number };

export type MockCode =
  | { kind: "valid"; picks: MockPick[] }
  | { kind: "expired" }
  | { kind: "unavailable" };

export type MockBackendConfig = {
  slug: BookmakerSlug;
  margin: number;
  eventId: (fixture: MockFixture) => string;
  offers: (fixture: MockFixture, prices: MockPrices, names: [string, string]) => RawOffer[];
  codes: Record<string, MockCode>;
  codePrefix: string;
  latencyMs: number;
};

type Adapter = Pick<BookmakerAdapter, "slug" | "mapMarket" | "unmapMarket">;

// Codes booked via createCode in mock mode, per process.
const createdCodes = new Map<string, MockCode>();

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function stableNumber(key: string, digits: number): string {
  const n = parseInt(createHash("sha256").update(key).digest("hex").slice(0, 12), 16);
  return String(n % 10 ** digits).padStart(digits, "0");
}

export function createMockBackend(config: MockBackendConfig, adapter: () => Adapter) {
  const listed = FIXTURES.filter((f) => !f.onlyOn || f.onlyOn.includes(config.slug));
  const namesOf = (f: MockFixture): [string, string] => f.names[config.slug] ?? f.names.sportybet;

  function eventOf(f: MockFixture, now = new Date()): BookmakerEventInfo {
    const [home, away] = namesOf(f);
    const kickoffAt = mockKickoff(f.kickoffOffsetMin, now);
    return {
      externalId: config.eventId(f),
      home,
      away,
      kickoffAt,
      competition: f.competition,
      country: f.country,
      status: kickoffAt.getTime() <= now.getTime() ? "LIVE" : "NOT_STARTED",
    };
  }

  function offersOf(f: MockFixture): RawOffer[] {
    return config.offers(f, derivePrices(f, config.margin), namesOf(f));
  }

  function findOffer(f: MockFixture, raw: RawMarket): RawOffer | undefined {
    return offersOf(f).find(
      (o) => o.raw.marketId === raw.marketId && o.raw.outcomeId === raw.outcomeId && o.raw.specifier === raw.specifier,
    );
  }

  function fixtureByKey(key: string) {
    const f = listed.find((x) => x.key === key);
    if (!f) throw new Error(`Mock fixture ${key} is not listed on ${config.slug}`);
    return f;
  }

  async function loadCode(code: string): Promise<LoadedSlip> {
    await sleep(config.latencyMs);
    const entry = createdCodes.get(`${config.slug}:${code}`) ?? config.codes[code];
    if (!entry) throw new AppError("INVALID_CODE", `We couldn't find booking code ${code}. Check it and try again.`);
    if (entry.kind === "expired") throw new AppError("EXPIRED_CODE", `Booking code ${code} has expired.`);
    if (entry.kind === "unavailable") {
      throw new AppError("BOOKMAKER_UNAVAILABLE", "The bookmaker isn't responding right now. Please try again shortly.");
    }

    const now = new Date();
    const a = adapter();
    const selections = entry.picks.map((pick) => {
      const f = fixtureByKey(pick.fixture);
      const event = eventOf(f, now);
      let raw: RawMarket;
      let odds: number | null;
      if ("market" in pick) {
        const unmapped = a.unmapMarket(pick.market, event);
        if (!unmapped) throw new Error(`Mock code ${code}: market not expressible on ${config.slug}`);
        const offer = findOffer(f, unmapped);
        raw = offer?.raw ?? unmapped;
        odds = offer?.odds ?? null;
      } else {
        raw = pick.raw;
        odds = pick.odds;
      }
      return { event, raw, market: mapOrLog(a, raw, event), odds };
    });

    const latestKickoff = Math.max(...selections.map((s) => s.event.kickoffAt.getTime()));
    return { bookmaker: config.slug, code, selections, expiresAt: new Date(latestKickoff) };
  }

  async function createCode(selections: CreateCodeSelection[]): Promise<CreatedCode> {
    await sleep(config.latencyMs);
    if (selections.length === 0) throw new AppError("BAD_REQUEST", "A slip needs at least one game.");
    const a = adapter();
    const picks: MockPick[] = selections.map((s, i) => {
      const f = listed.find((x) => config.eventId(x) === s.eventExternalId);
      if (!f) throw new AppError("BAD_REQUEST", `Game #${i + 1} isn't available on this bookmaker.`);
      const raw = a.unmapMarket(s.market, eventOf(f));
      if (!raw || !findOffer(f, raw)) {
        throw new AppError("BAD_REQUEST", `Game #${i + 1}: this market isn't offered on this bookmaker.`);
      }
      return { fixture: f.key, market: s.market };
    });

    let code: string;
    do {
      code = config.codePrefix + Array.from({ length: 6 - config.codePrefix.length }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(31)]).join("");
    } while (config.codes[code] || createdCodes.has(`${config.slug}:${code}`));
    createdCodes.set(`${config.slug}:${code}`, { kind: "valid", picks });

    const latest = Math.max(...picks.map((p) => mockKickoff(fixtureByKey(p.fixture).kickoffOffsetMin).getTime()));
    return { code, expiresAt: new Date(latest) };
  }

  async function searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]> {
    await sleep(config.latencyMs / 2);
    // Like a site search: loose on names (either team), strict on kickoff window.
    return listed
      .map((f) => eventOf(f))
      .filter((e) => Math.abs(e.kickoffAt.getTime() - kickoff.getTime()) <= 15 * 60_000)
      .filter((e) => Math.max(teamSimilarity(e.home, home), teamSimilarity(e.away, away)) >= 0.6);
  }

  async function getEventMarkets(eventExternalId: string): Promise<EventMarkets> {
    await sleep(config.latencyMs / 2);
    const f = listed.find((x) => config.eventId(x) === eventExternalId);
    if (!f) throw new AppError("NOT_FOUND", "That game isn't available on this bookmaker.");
    const event = eventOf(f);
    const a = adapter();
    return {
      event,
      offers: offersOf(f).map((o) => ({ ...o, market: a.mapMarket(o.raw, event) })),
    };
  }

  return { loadCode, createCode, searchEvent, getEventMarkets, events: () => listed.map((f) => eventOf(f)), offersOf };
}
