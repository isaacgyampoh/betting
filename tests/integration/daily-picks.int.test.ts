import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { generateDailyPicks, getTodaysPicks, getTrackRecord, ghanaDate, settleDailyPicks } from "@/lib/services/daily-picks";
import { createUser } from "./helpers";

async function publish(opts: { date: string; target: number; totalOdds: number; status?: "PENDING" | "WON" | "LOST"; legs?: number }) {
  return db.dailyPick.create({
    data: {
      forDate: new Date(opts.date),
      target: opts.target,
      totalOdds: opts.totalOdds,
      probability: 0.4,
      confidence: "medium",
      status: opts.status ?? "PENDING",
      legs: {
        create: Array.from({ length: opts.legs ?? 2 }, (_, i) => ({
          position: i + 1,
          homeTeam: `Home ${i}`,
          awayTeam: `Away ${i}`,
          kickoffAt: new Date(`${opts.date}T15:00:00Z`),
          marketLabel: "1X2",
          pickLabel: `Home ${i}`,
          odds: 1.5,
          reason: "Recent form and head-to-head lean this way.",
          apiFootballFixtureId: 900000 + i,
        })),
      },
    },
    include: { legs: true },
  });
}

describe("daily picks", () => {
  it("never publishes made-up odds when no bookmaker is connected", async () => {
    const result = await generateDailyPicks();
    expect(result.created).toBe(0);
    expect(result.skipped[0]).toMatch(/never publish made-up odds/);
    expect(await db.dailyPick.count({ where: { forDate: new Date(result.date) } })).toBe(0);
  });

  it("hides the games from plans without picks, and shows them to Weekly", async () => {
    await db.dailyPick.deleteMany();
    await publish({ date: ghanaDate(), target: 2, totalOdds: 2.1 });

    const free = await createUser();
    const locked = await getTodaysPicks(free.id);
    expect(locked[0].unlocked).toBe(false);
    expect(locked[0].legs).toHaveLength(0);
    expect(locked[0].totalOdds).toBe(2.1); // the slip exists and its odds are visible

    const paid = await createUser();
    const plan = await db.plan.findUniqueOrThrow({ where: { code: "pro_week" } });
    await db.subscription.create({
      data: { userId: paid.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    const unlocked = await getTodaysPicks(paid.id);
    expect(unlocked[0].unlocked).toBe(true);
    expect(unlocked[0].legs).toHaveLength(2);
    expect(unlocked[0].legs[0].reason).toMatch(/form|head-to-head/i);
  });

  it("track record counts wins and losses and computes win rate and ROI", async () => {
    await db.dailyPick.deleteMany();
    await publish({ date: "2026-09-20", target: 2, totalOdds: 2.0, status: "WON" });
    await publish({ date: "2026-09-21", target: 2, totalOdds: 2.0, status: "LOST" });
    await publish({ date: "2026-09-22", target: 5, totalOdds: 5.0, status: "WON" });
    await publish({ date: "2026-09-23", target: 5, totalOdds: 5.0, status: "LOST" });
    await publish({ date: ghanaDate(), target: 2, totalOdds: 2.2 });

    const record = await getTrackRecord();
    expect({ won: record.won, lost: record.lost, pending: record.pending }).toEqual({ won: 2, lost: 2, pending: 1 });
    expect(record.winRate).toBe(50);
    // staked 4, returned 2.0 + 5.0 = 7.0 → +75%
    expect(record.roi).toBe(75);
    const five = record.byTarget.find((t) => t.target === 5)!;
    expect(five).toMatchObject({ total: 2, won: 1, winRate: 50, roi: 150 });
    // Losses are always public, and so is every other settled pick.
    expect(record.picks.filter((p) => p.status === "LOST")).toHaveLength(2);
    expect(record.picks.filter((p) => p.status !== "PENDING").every((p) => p.unlocked)).toBe(true);
    // A pick still running keeps its games: that is what people pay for.
    expect(record.picks.filter((p) => p.status === "PENDING").every((p) => !p.unlocked)).toBe(true);
  });

  it("settles only from real results and leaves unknown games pending", async () => {
    await db.dailyPick.deleteMany();
    const pick = await publish({ date: ghanaDate(), target: 2, totalOdds: 2.25, legs: 2 });

    // First game finished, second unknown: the pick stays pending.
    await settleDailyPicks(async (leg) => (leg.apiFootballFixtureId === 900000 ? { status: "WON", resultText: "2-1" } : null));
    expect((await db.dailyPick.findUniqueOrThrow({ where: { id: pick.id } })).status).toBe("PENDING");

    // Second game lost: the whole slip is lost.
    await settleDailyPicks(async (leg) => (leg.apiFootballFixtureId === 900001 ? { status: "LOST", resultText: "0-3" } : null));
    const settled = await db.dailyPick.findUniqueOrThrow({ where: { id: pick.id }, include: { legs: true } });
    expect(settled.status).toBe("LOST");
    expect(settled.settledAt).not.toBeNull();
    expect(settled.legs.map((l) => l.resultText).sort()).toEqual(["0-3", "2-1"]);
  });

  it("one pick per target per day", async () => {
    await db.dailyPick.deleteMany();
    await publish({ date: "2026-09-19", target: 2, totalOdds: 2.0 });
    await expect(publish({ date: "2026-09-19", target: 2, totalOdds: 2.5 })).rejects.toThrow();
  });
});

// The public record has to be checkable without giving away the thing people pay for. A settled
// pick is fully open to everyone; one still running keeps its games until it settles.
describe("track record and unsettled picks", () => {
  it("shows a settled pick's games to everyone but holds back a running one's", async () => {
    await db.dailyPick.deleteMany();
    const plan = await db.plan.findFirstOrThrow({ where: { code: { startsWith: "vip" } } });
    void plan;

    const leg = (position: number) => ({
      position,
      homeTeam: "A",
      awayTeam: "B",
      competition: "L",
      kickoffAt: new Date(),
      marketLabel: "Over/Under",
      pickLabel: "Over 1.5 goals",
      odds: 1.5,
      reason: "because",
    });

    await db.dailyPick.create({
      data: { forDate: new Date("2026-09-30"), target: 2, totalOdds: 2.1, probability: 0.5, confidence: "medium", status: "WON", legs: { create: [leg(1)] } },
    });
    await db.dailyPick.create({
      data: { forDate: new Date("2026-10-01"), target: 5, totalOdds: 5.1, probability: 0.2, confidence: "low", status: "PENDING", legs: { create: [leg(1)] } },
    });

    const record = await getTrackRecord();
    const settled = record.picks.find((p) => p.status === "WON")!;
    const running = record.picks.find((p) => p.status === "PENDING")!;

    expect(settled.unlocked).toBe(true);
    expect(settled.legs).toHaveLength(1);

    // Still running: the header is public, the games are not.
    expect(running.unlocked).toBe(false);
    expect(running.legs).toEqual([]);
    expect(running.totalOdds).toBe(5.1);

    // Leave the table as it was found: the first test in this file asserts an empty one.
    await db.dailyPick.deleteMany();
  });
});
