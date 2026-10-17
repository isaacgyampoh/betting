import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { follow, setMuted } from "@/lib/services/follows";
import { createUser } from "./helpers";
import type { MatchEvent, MatchSummary } from "@/lib/stats/types";

/**
 * The alerting pass: what is new, who wants it, and never twice.
 *
 * This is the piece the pipeline was missing. Tokens, preferences, the sender and the device all
 * worked; nothing ever decided that something had happened. The behaviour that matters most here
 * is the one that is invisible when it works - a goal read on five consecutive passes produces
 * one notification, not five.
 */
const sent: { profileId: string; title: string; body: string; route?: string }[] = [];

vi.mock("@/lib/services/fcm", () => ({
  canSendPush: () => true,
  sendToUser: async (profileId: string, message: { title: string; body: string; route?: string }) => {
    sent.push({ profileId, ...message });
    return { sent: 1, failed: 0, revoked: 0 };
  },
}));

const base: MatchSummary = {
  id: 9_100_001,
  kickoffAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  status: "LIVE",
  statusLabel: "30'",
  minute: 30,
  league: { id: 1, name: "Test League", country: "Testland", season: 2026, logo: null },
  home: { id: 8001, name: "Home FC", logo: null },
  away: { id: 8002, name: "Away FC", logo: null },
  goals: { home: 1, away: 0 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let fixtureState: MatchSummary = base;
let eventState: MatchEvent[] = [];

vi.mock("@/lib/services/stats", () => ({
  statsProvider: () => ({
    source: "test",
    // Honours the id it is asked for. Returning the same match for every id made "following a
    // different match" look like a bug in the code when it was a lie in the fixture.
    fixture: async (id: number) => (id === fixtureState.id ? fixtureState : null),
    events: async (id: number) => (id === fixtureState.id ? eventState : []),
    fixturesByDate: async () => [fixtureState],
  }),
}));

const goal = (minute: number, player: string): MatchEvent => ({
  minute,
  extra: null,
  side: "HOME",
  type: "GOAL",
  player,
  other: null,
  detail: "Normal Goal",
});

async function run() {
  const { runMatchAlerts } = await import("@/lib/services/match-alerts");
  return runMatchAlerts();
}

describe("alerting on a followed match", () => {
  beforeEach(async () => {
    sent.length = 0;
    fixtureState = { ...base };
    eventState = [];
    await db.notificationDelivery.deleteMany({});
    await db.follow.deleteMany({});
  });

  it("tells a follower about a goal", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id, { label: "Home FC v Away FC" });
    eventState = [goal(30, "A Striker")];

    await run();
    const goals = sent.filter((s) => s.body.includes("A Striker"));
    expect(goals).toHaveLength(1);
    expect(goals[0]!.profileId).toBe(user.id);
    expect(goals[0]!.route).toBe(`/home/match/${base.id}`);
  });

  /** The one that matters: the job re-reads the same live match every time it runs. */
  it("does not announce the same goal again on the next pass", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);
    eventState = [goal(30, "A Striker")];

    await run();
    await run();
    await run();

    expect(sent.filter((s) => s.body.includes("A Striker"))).toHaveLength(1);
  });

  it("announces a second goal by the same player at a different minute", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);
    eventState = [goal(30, "A Striker")];
    await run();

    eventState = [goal(30, "A Striker"), goal(70, "A Striker")];
    await run();

    expect(sent.filter((s) => s.body.includes("A Striker"))).toHaveLength(2);
  });

  it("tells someone who follows a team in the match", async () => {
    const user = await createUser();
    await follow(user.id, "TEAM", 8002, { label: "Away FC" });
    eventState = [goal(30, "A Striker")];

    await run();
    expect(sent.some((s) => s.profileId === user.id)).toBe(true);
  });

  it("says nothing to someone who muted the match", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);
    await setMuted(user.id, "FIXTURE", base.id, true);
    eventState = [goal(30, "A Striker")];

    await run();
    expect(sent.some((s) => s.profileId === user.id)).toBe(false);
  });

  it("says nothing about goals to someone who turned goals off", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id, { alerts: { goals: false } });
    eventState = [goal(30, "A Striker")];

    await run();
    expect(sent.some((s) => s.body.includes("A Striker"))).toBe(false);
  });

  it("says nothing to someone following a different match", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 9_999_999);
    eventState = [goal(30, "A Striker")];

    await run();
    expect(sent.some((s) => s.profileId === user.id)).toBe(false);
  });

  it("announces full time once when the match ends", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);

    await run(); // live, nothing yet
    fixtureState = { ...base, status: "FINISHED", statusLabel: "FT" };
    await run();
    await run();

    expect(sent.filter((s) => s.body === "Full time.")).toHaveLength(1);
  });

  it("does not poll a match that has not kicked off", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);
    fixtureState = {
      ...base,
      status: "SCHEDULED",
      kickoffAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    };

    const result = await run();
    expect(result.fixturesChecked).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("counts a repeat as already sent rather than sending it", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", base.id);
    eventState = [goal(30, "A Striker")];

    await run();
    const second = await run();
    expect(second.alreadySent).toBeGreaterThan(0);
    expect(second.notificationsSent).toBe(0);
  });

  it("reaches two followers of the same match", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    await follow(a.id, "FIXTURE", base.id);
    await follow(b.id, "FIXTURE", base.id);
    eventState = [goal(30, "A Striker")];

    await run();
    const recipients = new Set(sent.filter((s) => s.body.includes("A Striker")).map((s) => s.profileId));
    expect(recipients).toEqual(new Set([a.id, b.id]));
  });

  it("does nothing at all when nobody follows anything", async () => {
    eventState = [goal(30, "A Striker")];
    const result = await run();
    expect(result.fixturesChecked).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
