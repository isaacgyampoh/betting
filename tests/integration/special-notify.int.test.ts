import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { specialNotifyKey } from "@/lib/services/special-notify";

/**
 * The three rules the brief sets for the notification: only on a publication, never twice, and
 * nothing about the selection itself in the message.
 */
const DATE = "2026-11-02";
const KEY = specialNotifyKey(DATE);

const pick = {
  forDate: new Date(DATE),
  position: 1,
  statsFixtureId: 4242,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  competition: "Premier League",
  country: "England",
  kickoffAt: new Date("2026-11-02T12:00:00Z"),
  marketKind: "CORNERS",
  marketSide: "MATCH",
  marketPeriod: "FT",
  line: 9.5,
  outcome: "OVER",
  bookmaker: "sportybet",
  rawMarketName: "Corners - Over/Under",
  odds: 1.9,
  oddsCheckedAt: new Date(),
  probability: 0.72,
  confidence: "medium",
  rating: 62,
  reason: "Over 9.5 in 6 of 8.",
  evidence: {},
  researchedAt: new Date(),
};

/** A profile with a web push subscription - the audience, and the only audience. */
async function subscriber(email: string) {
  const user = await db.profile.create({ data: { id: crypto.randomUUID(), email } });
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: `https://push.example/${user.id}`, p256dh: "k", auth: "a" },
  });
  return user.id;
}

beforeEach(async () => {
  await db.notificationDelivery.deleteMany({ where: { eventKey: KEY } });
  await db.specialPick.deleteMany({});
  await db.pushSubscription.deleteMany({ where: { endpoint: { startsWith: "https://push.example/" } } });
  await db.profile.deleteMany({ where: { email: { endsWith: "@notify.test" } } });
  // No VAPID keys in the test environment, so notifyUser returns without sending. The claim is
  // what is being tested here; whether a push service accepted it is push.ts's business.
  vi.stubEnv("VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
});

describe("notifying that the day's selections are up", () => {
  it("says nothing when nothing was published", async () => {
    await subscriber("quiet@notify.test");
    const { notifySpecialPicks } = await import("@/lib/services/special-notify");
    const r = await notifySpecialPicks(DATE);

    expect(r.recipients).toBe(0);
    expect(await db.notificationDelivery.count({ where: { eventKey: KEY } })).toBe(0);
  });

  it("claims one delivery per person when a selection is published", async () => {
    await subscriber("a@notify.test");
    await subscriber("b@notify.test");
    await db.specialPick.create({ data: pick });

    const { notifySpecialPicks } = await import("@/lib/services/special-notify");
    const r = await notifySpecialPicks(DATE);

    expect(r.recipients).toBe(2);
    expect(r.alreadyNotified).toBe(0);
    expect(await db.notificationDelivery.count({ where: { eventKey: KEY } })).toBe(2);
  });

  it("does not notify the same person twice when the job runs again", async () => {
    await subscriber("a@notify.test");
    await db.specialPick.create({ data: pick });

    const { notifySpecialPicks } = await import("@/lib/services/special-notify");
    await notifySpecialPicks(DATE);
    const second = await notifySpecialPicks(DATE);

    expect(second.alreadyNotified).toBe(1);
    expect(second.notified).toBe(0);
    expect(await db.notificationDelivery.count({ where: { eventKey: KEY } })).toBe(1);
  });

  // Somebody who turns notifications on after the morning job should still hear about today.
  it("reaches a person who subscribed after the first run", async () => {
    await subscriber("early@notify.test");
    await db.specialPick.create({ data: pick });
    const { notifySpecialPicks } = await import("@/lib/services/special-notify");
    await notifySpecialPicks(DATE);

    await subscriber("late@notify.test");
    const second = await notifySpecialPicks(DATE);

    expect(second.alreadyNotified).toBe(1);
    expect(await db.notificationDelivery.count({ where: { eventKey: KEY } })).toBe(2);
  });

  it("notifies nobody when nobody asked to be notified", async () => {
    await db.specialPick.create({ data: pick });
    const { notifySpecialPicks } = await import("@/lib/services/special-notify");
    expect((await notifySpecialPicks(DATE)).recipients).toBe(0);
  });

  // A different day is a different key, so yesterday's claim cannot silence today.
  it("uses a separate key for each day", () => {
    expect(specialNotifyKey("2026-11-02")).not.toBe(specialNotifyKey("2026-11-03"));
  });
});
