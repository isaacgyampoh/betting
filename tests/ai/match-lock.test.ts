import { describe, expect, it } from "vitest";
import {
  checkToolAgainstLock,
  lockContext,
  lockedTools,
  lockFromDetail,
  unlockedTools,
  type MatchLock,
} from "@/lib/ai/match-lock";
import type { MatchDetail, MatchStatus, MatchSummary, TeamForm, TeamRef } from "@/lib/stats/types";

// The failure these pin actually happened: a thread opened from Ipswich v Nottingham Forest,
// asked for "a two odds for this game", answered with selections from other fixtures. The cause
// was not the wording of the prompt - it was that the tools which search every fixture on the
// card were offered inside a conversation about one game.

const team = (id: number, name: string): TeamRef => ({ id, name, logo: null });
const IPSWICH = team(1, "Ipswich Town");
const FOREST = team(2, "Nottingham Forest");

const summary = (status: MatchStatus = "SCHEDULED", id = 7001): MatchSummary => ({
  id,
  kickoffAt: "2026-10-25T14:00:00.000Z",
  status,
  statusLabel: status === "FINISHED" ? "Match Finished" : status === "LIVE" ? "63'" : "Not Started",
  league: { id: 39, name: "Premier League", country: "England", season: 2026, logo: null },
  home: IPSWICH,
  away: FOREST,
  goals: status === "SCHEDULED" ? { home: null, away: null } : { home: 1, away: 2 },
});

const zero = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, bttsRate: 0, over25Rate: 0 };
const emptyForm = (t: TeamRef): TeamForm => ({
  team: t,
  matches: [],
  summary: { ...zero },
  splits: { home: { ...zero }, away: { ...zero } },
});

const detail = (status: MatchStatus = "SCHEDULED"): MatchDetail => ({
  match: summary(status),
  form: { home: emptyForm(IPSWICH), away: emptyForm(FOREST) },
  h2h: [],
  standings: null,
  events: [],
  coverage: null,
  statistics: [],
  lineups: [],
  unavailable: [],
  busy: false,
  source: "api-football",
});

const lock = (status: MatchStatus = "SCHEDULED"): MatchLock => lockFromDetail(detail(status));

const tool = (name: string) => ({ name, description: "", input_schema: { type: "object" as const } });
const ALL = [
  tool("get_match_stats"),
  tool("analyze_match"),
  tool("find_matches"),
  tool("build_slip_from_fixtures"),
  tool("load_slip"),
  tool("convert_slip"),
];

describe("the fixture a locked conversation is about", () => {
  it("is taken from the authoritative record, not from team names", () => {
    const l = lock();
    expect(l.matchId).toBe(7001);
    expect(l.home).toEqual({ id: 1, name: "Ipswich Town" });
    expect(l.away).toEqual({ id: 2, name: "Nottingham Forest" });
    expect(l.competition).toBe("Premier League");
    expect(l.season).toBe(2026);
  });

  it("records which sections actually have data", () => {
    const l = lock();
    expect(l.has.statistics).toBe(false);
    expect(l.has.h2h).toBe(false);
    expect(l.has.lineups).toBe(false);
  });
});

describe("tools that can reach another fixture", () => {
  it("are withheld from a locked conversation", () => {
    const names = lockedTools(ALL).map((t) => t.name);
    expect(names).not.toContain("build_slip_from_fixtures");
    expect(names).not.toContain("find_matches");
  });

  it("leave the match-scoped and slip tools in place", () => {
    const names = lockedTools(ALL).map((t) => t.name);
    // A missing booking code must never block match analysis, and conversion must still work
    // if the user pastes one into this thread.
    expect(names).toEqual(["get_match_stats", "analyze_match", "load_slip", "convert_slip"]);
  });

  it("withholds the slip builder, which can only ask for a code it does not need", () => {
    expect(lockedTools(ALL.concat(tool("build_target_slip"))).map((t) => t.name)).not.toContain(
      "build_target_slip",
    );
    const check = checkToolAgainstLock(lock(), "build_target_slip", { slip_id: "x", target: 2 });
    expect(check.ok).toBe(false);
  });

  it("are refused even if the model calls one anyway", () => {
    const check = checkToolAgainstLock(lock(), "build_slip_from_fixtures", { target: 2 });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("MATCH_LOCKED");
      expect(check.reason).toContain("Ipswich Town v Nottingham Forest");
      expect(check.reason).toContain("7001");
    }
  });
});

describe("a tool that names a fixture by id", () => {
  it("is allowed for the locked fixture", () => {
    expect(checkToolAgainstLock(lock(), "get_match_stats", { match_id: 7001 }).ok).toBe(true);
  });

  it("is refused for any other fixture, and says which one it should use", () => {
    const check = checkToolAgainstLock(lock(), "analyze_match", { match_id: 9999 });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("not match_id 9999");
      expect(check.reason).toContain("match_id 7001");
    }
  });

  it("is allowed when no id is given, so the tool's own default applies", () => {
    expect(checkToolAgainstLock(lock(), "get_match_stats", {}).ok).toBe(true);
  });

  it("does not block the slip tools, which carry no fixture id", () => {
    expect(checkToolAgainstLock(lock(), "load_slip", { code: "ABC123" }).ok).toBe(true);
    expect(checkToolAgainstLock(lock(), "convert_slip", { slip_id: "x", target: "sportybet" }).ok).toBe(true);
  });
});

describe("the context the model is given", () => {
  it("states the lock and the fixture's identifiers", () => {
    const text = lockContext(lock());
    expect(text).toContain("LOCKED TO ONE FIXTURE");
    expect(text).toContain('"match_id": 7001');
    expect(text).toContain("Ipswich Town");
    expect(text).toContain("Nottingham Forest");
  });

  it("forbids substituting a fixture with better odds", () => {
    expect(lockContext(lock())).toContain("better odds");
  });

  it("never describes a finished match as upcoming or in play", () => {
    const text = lockContext(lock("FINISHED"));
    expect(text).toContain("FINISHED");
    expect(text).toContain("past tense");
    expect(text).toContain("never offer a selection on it");
  });

  it("says a live score may already be stale", () => {
    expect(lockContext(lock("LIVE"))).toContain("out of date");
  });

  it("refuses selections on a postponed match", () => {
    expect(lockContext(lock("POSTPONED"))).toContain("Do not offer any selection on it");
  });

  it("does not imply a scoreline before kick-off", () => {
    expect(lockContext(lock())).toContain("has not kicked off");
  });

  it("flags sample data as not real", () => {
    const sample = lockFromDetail({ ...detail(), source: "sample" });
    expect(lockContext(sample)).toContain("SAMPLE DATA");
  });
});

describe("app actions the assistant cannot perform", () => {
  it("is told it cannot follow a match or save anything", () => {
    const text = lockContext(lock());
    expect(text).toContain("cannot follow a match");
    expect(text).toContain("never claim to have done it");
  });

  it("points at the real control rather than offering to do it", () => {
    expect(lockContext(lock())).toContain("bell at the top of this sheet");
  });
});

// The two failures seen on a real device against the pre-lock build. Both had the match id and
// asked for it anyway, which is the difference between an analyst and a form.
describe("asking the user what it already knows", () => {
  it("is forbidden for the match", () => {
    expect(lockContext(lock())).toContain("Never ask the user which match they mean");
  });

  it("is forbidden for a booking code", () => {
    const text = lockContext(lock());
    expect(text).toContain("Never ask for a booking code or a slip id");
    expect(text).toContain("never about a slip");
  });

  it("switches off the slip-first default from the general instructions", () => {
    expect(lockContext(lock())).toContain("does NOT apply in this conversation");
  });

  it("names half-time and risks as match questions, since both were refused in the field", () => {
    const text = lockContext(lock());
    expect(text).toContain("half-time");
    expect(text).toContain("risks");
  });
});

// Observed in production after the lock shipped: the fixture stayed correct, but "give me a good
// two odds selection for this game" was answered with "I need a booking code to build a slip for
// you". Right match, wrong answer - the user asked about a fixture, not about a slip.
describe("being asked for a selection on this match", () => {
  it("sends it to the tool that reads real prices, not to a booking code", () => {
    const text = lockContext(lock());
    expect(text).toContain("call get_match_markets");
    expect(text).toContain("Do NOT ask for");
    expect(text).toContain("booking code");
  });

  it("forbids quoting a price the tool did not return", () => {
    const text = lockContext(lock());
    expect(text).toContain("Quote only prices it returned");
    expect(text).toContain("do not estimate a price");
  });

  it("allows naming the unpriced market groups but never their prices", () => {
    const text = lockContext(lock());
    expect(text).toContain("offeredWithoutPrice");
    expect(text).toContain("never what they pay");
  });
});

// The tool reads the fixture from the lock and takes no arguments, so there is no id to get
// wrong - but it is meaningless outside a locked conversation and would only throw there.
describe("the market tool's availability", () => {
  const WITH = ALL.concat(tool("get_match_markets"));

  it("is offered inside a locked conversation", () => {
    expect(lockedTools(WITH).map((t) => t.name)).toContain("get_match_markets");
  });

  it("is withheld outside one, rather than left to throw", () => {
    expect(unlockedTools(WITH).map((t) => t.name)).not.toContain("get_match_markets");
  });

  it("leaves the global search tools alone when unlocked", () => {
    const names = unlockedTools(WITH).map((t) => t.name);
    expect(names).toContain("build_slip_from_fixtures");
    expect(names).toContain("find_matches");
  });
});
