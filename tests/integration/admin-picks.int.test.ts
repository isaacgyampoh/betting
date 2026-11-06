import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  pipelineStatus,
  recentDays,
  slipDesk,
  voidSpecialPick,
  voidSpecialSlip,
} from "@/lib/services/admin-picks";
import { createUser } from "./helpers";

/**
 * The Slip Desk against a real database.
 *
 * The unit tests cover the rules. These cover the one thing the desk can do that the rules cannot:
 * change a published row. Every assertion here is about a boundary on that power - what it refuses
 * to touch, what it records, and what it leaves exactly as it found it - because the whole value
 * of a published record is that it cannot be quietly improved after the fact.
 */

const DATE = "2026-11-06";

const legBase = {
  forDate: new Date(DATE),
  statsFixtureId: 5001,
  homeTeam: "Sevilla",
  awayTeam: "Alaves",
  competition: "LaLiga",
  country: "Spain",
  kickoffAt: new Date("2026-11-06T20:00:00Z"),
  marketKind: "SHOTS_ON_TARGET",
  marketSide: "MATCH",
  marketPeriod: "FT",
  line: 4.5,
  outcome: "OVER",
  bookmaker: "sportybet",
  rawMarketName: "Shots on target",
  odds: 1.06,
  oddsCheckedAt: new Date("2026-11-06T07:01:00Z"),
  probability: 0.9,
  confidence: "high",
  rating: 64,
  reason: "Over 4.5 in 16 of 16.",
  evidence: { sample: 16 },
  researchedAt: new Date("2026-11-06T07:01:00Z"),
};

/** Friday's slip, as it actually went out: a losing price and a leg from the following day. */
async function publishFriday(legs?: Partial<typeof legBase & { status: string }>[]) {
  const slip = await db.specialSlip.create({
    data: {
      forDate: new Date(DATE),
      reference: "GC261106",
      combinedOdds: 1.887,
      target: 2,
      summary: "Test slip.",
      publishedAt: new Date("2026-11-06T07:01:00Z"),
    },
  });
  const spec = legs ?? [
    {},
    {
      statsFixtureId: 5002,
      homeTeam: "Bristol City",
      awayTeam: "Norwich",
      competition: "Championship",
      kickoffAt: new Date("2026-11-07T12:30:00Z"),
      odds: 1.78,
      probability: 0.72,
    },
  ];
  const picks = [];
  for (const [i, over] of spec.entries()) {
    picks.push(
      await db.specialPick.create({
        data: { ...legBase, ...over, slipId: slip.id, position: i + 1, status: (over.status ?? "PENDING") as never },
      }),
    );
  }
  return { slip, picks };
}

async function makeAdmin() {
  const user = await createUser();
  await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  return user;
}

beforeEach(async () => {
  await db.adminAudit.deleteMany({});
  await db.specialSlip.deleteMany({});
  await db.specialPick.deleteMany({});
});

describe("reading a published day", () => {
  it("computes the expected value the generator never showed anyone", async () => {
    await publishFriday();
    const desk = await slipDesk(DATE, new Date("2026-11-06T09:00:00Z"));

    const alaves = desk.legs.find((l) => l.away === "Alaves")!;
    expect(alaves.ev).toBeCloseTo(-0.046, 3);
    expect(alaves.findings.map((f) => f.code)).toContain("priced-at-a-loss");
  });

  it("marks the leg that belongs to another day, and says so on the slip too", async () => {
    await publishFriday();
    const desk = await slipDesk(DATE, new Date("2026-11-06T09:00:00Z"));

    const bristol = desk.legs.find((l) => l.home === "Bristol City")!;
    expect(bristol.kickoffDay).toBe("2026-11-07");
    expect(bristol.findings.map((f) => f.code)).toContain("off-day");
    expect(desk.slipFindings.map((f) => f.code)).toContain("mixed-days");
    expect(desk.severity).toBe("bad");
  });

  it("reads legs published before slips existed, which carry no slip id", async () => {
    await db.specialPick.create({ data: { ...legBase, position: 1, slipId: null } });
    const desk = await slipDesk(DATE, new Date("2026-11-06T09:00:00Z"));
    expect(desk.slip).toBeNull();
    expect(desk.legs).toHaveLength(1);
  });

  it("reports a day with no slip as a day with no slip, not as a gap", async () => {
    const days = await recentDays(3, new Date("2026-11-06T09:00:00Z"));
    expect(days.map((d) => d.date)).toEqual(["2026-11-06", "2026-11-05", "2026-11-04"]);
    expect(days.every((d) => d.status === "NONE")).toBe(true);
  });
});

describe("voiding one selection", () => {
  it("voids it, records who and why, and changes nothing else about the row", async () => {
    const admin = await makeAdmin();
    const { picks } = await publishFriday();
    const before = picks[0];

    await voidSpecialPick(admin.id, before.id, "Published at a price that loses money.");

    const after = await db.specialPick.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe("VOID");
    expect(after.settledAt).not.toBeNull();
    // The published record itself is untouched: the price, the estimate and the reasoning stand.
    expect(Number(after.odds)).toBe(Number(before.odds));
    expect(Number(after.probability)).toBe(Number(before.probability));
    expect(after.reason).toBe(before.reason);

    const entry = await db.adminAudit.findFirstOrThrow({ where: { action: "special.pick.void" } });
    expect(entry.actorId).toBe(admin.id);
    expect(entry.target).toBe(before.id);
    expect(JSON.stringify(entry.detail)).toContain("loses money");
  });

  /**
   * The boundary that matters most. A dashboard able to turn a loss into a void is a dashboard
   * able to flatter the published win rate, which is the one number the product is judged on.
   */
  it("refuses to touch a selection that has already been graded", async () => {
    const admin = await makeAdmin();
    const { picks } = await publishFriday([{ status: "LOST" }, { statsFixtureId: 5002, status: "WON" }]);

    await expect(voidSpecialPick(admin.id, picks[0].id, "I would rather it had not lost.")).rejects.toThrow(/already/i);
    expect((await db.specialPick.findUniqueOrThrow({ where: { id: picks[0].id } })).status).toBe("LOST");
    expect(await db.adminAudit.count()).toBe(0);
  });

  it("insists on a reason, because the reason is the point of the record", async () => {
    const admin = await makeAdmin();
    const { picks } = await publishFriday();
    await expect(voidSpecialPick(admin.id, picks[0].id, "  ")).rejects.toThrow(/reason/i);
    expect((await db.specialPick.findUniqueOrThrow({ where: { id: picks[0].id } })).status).toBe("PENDING");
  });

  it("completes the slip when the last open leg goes, using the nightly job's own rule", async () => {
    const admin = await makeAdmin();
    const { slip, picks } = await publishFriday([{ status: "WON" }, { statsFixtureId: 5002, status: "PENDING" }]);

    const { rolled } = await voidSpecialPick(admin.id, picks[1].id, "Fixture belonged to the following day.");

    // One winner and one void is a won slip: a void leg drops out rather than sinking it.
    expect(rolled).toBe("WON");
    expect((await db.specialSlip.findUniqueOrThrow({ where: { id: slip.id } })).status).toBe("WON");
  });

  it("leaves the slip open while another leg is still running", async () => {
    const admin = await makeAdmin();
    const { slip, picks } = await publishFriday();
    const { rolled } = await voidSpecialPick(admin.id, picks[0].id, "Priced at a loss.");
    expect(rolled).toBeNull();
    expect((await db.specialSlip.findUniqueOrThrow({ where: { id: slip.id } })).status).toBe("PENDING");
  });
});

describe("voiding a whole slip", () => {
  it("voids the slip and every open leg, and records how many", async () => {
    const admin = await makeAdmin();
    const { slip } = await publishFriday();

    const { legsVoided } = await voidSpecialSlip(admin.id, slip.id, "Slip mixed two different days.");

    expect(legsVoided).toBe(2);
    const after = await db.specialSlip.findUniqueOrThrow({ where: { id: slip.id }, include: { picks: true } });
    expect(after.status).toBe("VOID");
    expect(after.picks.every((p) => p.status === "VOID")).toBe(true);

    const entry = await db.adminAudit.findFirstOrThrow({ where: { action: "special.slip.void" } });
    expect(JSON.stringify(entry.detail)).toContain("GC261106");
  });

  /** A graded leg keeps its result: voiding the slip is a statement about the product, not the pitch. */
  it("leaves already-graded legs alone", async () => {
    const admin = await makeAdmin();
    const { slip, picks } = await publishFriday([{ status: "WON" }, { statsFixtureId: 5002, status: "PENDING" }]);

    const { legsVoided } = await voidSpecialSlip(admin.id, slip.id, "Should not have gone out.");

    expect(legsVoided).toBe(1);
    expect((await db.specialPick.findUniqueOrThrow({ where: { id: picks[0].id } })).status).toBe("WON");
  });

  it("refuses a slip that has already settled", async () => {
    const admin = await makeAdmin();
    const { slip } = await publishFriday();
    await db.specialSlip.update({ where: { id: slip.id }, data: { status: "LOST", settledAt: new Date() } });
    await expect(voidSpecialSlip(admin.id, slip.id, "Reconsidered.")).rejects.toThrow(/already/i);
  });
});

describe("whether the scheduled jobs are running", () => {
  /**
   * The failure this view exists for. `refreshSpecialOdds` ran daily for weeks and could never
   * match a row, so it wrote nothing and nothing anywhere said so.
   */
  it("reports a job that has never written anything as never run", async () => {
    const jobs = await pipelineStatus(new Date("2026-11-06T09:00:00Z"));
    const refresh = jobs.find((j) => j.key === "refresh")!;
    expect(refresh.lastAt).toBeNull();
    expect(refresh.state).toBe("bad");
    expect(refresh.note).toMatch(/no evidence this has ever run/i);
  });

  it("reports a job as running once it has left a trace", async () => {
    const { picks } = await publishFriday();
    await db.specialPickOdds.create({
      data: { id: randomUUID(), pickId: picks[0].id, bookmaker: "sportybet", odds: 1.12, line: 4.5, checkedAt: new Date("2026-11-06T08:00:00Z") },
    });
    const jobs = await pipelineStatus(new Date("2026-11-06T09:00:00Z"));
    expect(jobs.find((j) => j.key === "refresh")!.state).toBe("ok");
  });

  it("names today's slip on the publish row when there is one", async () => {
    await publishFriday();
    const jobs = await pipelineStatus(new Date("2026-11-06T09:00:00Z"));
    expect(jobs.find((j) => j.key === "publish")!.note).toContain("GC261106");
  });
});
