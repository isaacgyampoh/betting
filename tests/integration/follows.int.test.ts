import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  DEFAULT_ALERTS,
  audienceFor,
  follow,
  listFollows,
  setMuted,
  unfollow,
} from "@/lib/services/follows";
import { createUser } from "./helpers";

/**
 * Following a match, not only a team.
 *
 * The app could previously follow teams and only on the device, which meant two things: you
 * could not follow a single match, and the server had no idea what anybody cared about - so it
 * could not have sent a notification even with working push credentials.
 */
describe("following", () => {
  it("follows a fixture and a team separately", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 1557430, { label: "Everton v Chelsea" });
    await follow(user.id, "TEAM", 45, { label: "Everton" });

    const rows = await listFollows(user.id);
    expect(rows).toHaveLength(2);
    // They are different intentions and must stay distinguishable: one match, versus every game
    // a team plays.
    expect(rows.map((r) => r.kind).sort()).toEqual(["FIXTURE", "TEAM"]);
  });

  it("the same id as a fixture and as a team are two different follows", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 999);
    await follow(user.id, "TEAM", 999);
    expect(await listFollows(user.id)).toHaveLength(2);
  });

  it("following twice is following once", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 42);
    await follow(user.id, "FIXTURE", 42);
    await follow(user.id, "FIXTURE", 42);
    expect(await listFollows(user.id)).toHaveLength(1);
  });

  it("defaults to alerting on kickoff, goals, red cards and full time", async () => {
    const user = await createUser();
    const row = await follow(user.id, "FIXTURE", 7);
    expect(row.alerts).toEqual(DEFAULT_ALERTS);
    // Half-time off by default: the one people switch off first.
    expect(row.alerts.halfTime).toBe(false);
  });

  it("keeps alert preferences when only the label is refreshed", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 8, { alerts: { goals: false, halfTime: true } });
    // The app refreshes labels opportunistically; doing so must not quietly reset what somebody
    // chose to hear about.
    const after = await follow(user.id, "FIXTURE", 8, { label: "Arsenal v Spurs" });
    expect(after.alerts.goals).toBe(false);
    expect(after.alerts.halfTime).toBe(true);
    expect(after.label).toBe("Arsenal v Spurs");
  });

  it("unfollowing something not followed is not an error", async () => {
    const user = await createUser();
    await expect(unfollow(user.id, "FIXTURE", 123456)).resolves.toBeUndefined();
  });

  it("muting keeps the follow but silences it", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 10);
    const muted = await setMuted(user.id, "FIXTURE", 10, true);
    expect(muted.muted).toBe(true);
    // Still followed - it belongs on the Following screen, just quiet.
    expect(await listFollows(user.id)).toHaveLength(1);
  });

  it("refuses to mute something that is not followed", async () => {
    const user = await createUser();
    await expect(setMuted(user.id, "FIXTURE", 404, true)).rejects.toThrow(/not following/);
  });
});

describe("who hears about an event", () => {
  it("includes someone following the fixture and someone following either team", async () => {
    const fixture = 2_000_001;
    const [home, away, both, nobody] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);
    await follow(home.id, "TEAM", 50);
    await follow(away.id, "TEAM", 51);
    await follow(both.id, "FIXTURE", fixture);
    await follow(nobody.id, "TEAM", 9999);

    const audience = await audienceFor(fixture, [50, 51], "goals");
    expect(audience).toEqual(expect.arrayContaining([home.id, away.id, both.id]));
    expect(audience).not.toContain(nobody.id);
  });

  it("counts someone once when they follow both the match and a team in it", async () => {
    const fixture = 2_000_002;
    const user = await createUser();
    await follow(user.id, "FIXTURE", fixture);
    await follow(user.id, "TEAM", 60);

    const audience = await audienceFor(fixture, [60, 61], "goals");
    // Two reasons to be told is still one notification.
    expect(audience.filter((id) => id === user.id)).toHaveLength(1);
  });

  it("leaves out anyone who muted the follow", async () => {
    const fixture = 2_000_003;
    const user = await createUser();
    await follow(user.id, "FIXTURE", fixture);
    await setMuted(user.id, "FIXTURE", fixture, true);

    expect(await audienceFor(fixture, [70, 71], "goals")).not.toContain(user.id);
  });

  it("leaves out anyone who turned that event off", async () => {
    const fixture = 2_000_004;
    const user = await createUser();
    await follow(user.id, "FIXTURE", fixture, { alerts: { goals: false, fullTime: true } });

    expect(await audienceFor(fixture, [], "goals")).not.toContain(user.id);
    // ...but still hears the thing they did want.
    expect(await audienceFor(fixture, [], "fullTime")).toContain(user.id);
  });

  it("does not tell someone about a match they do not follow", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 3_000_001);
    expect(await audienceFor(3_000_002, [], "goals")).not.toContain(user.id);
  });

  it("unfollowing removes someone from the audience", async () => {
    const fixture = 2_000_005;
    const user = await createUser();
    await follow(user.id, "FIXTURE", fixture);
    expect(await audienceFor(fixture, [], "goals")).toContain(user.id);

    await unfollow(user.id, "FIXTURE", fixture);
    expect(await audienceFor(fixture, [], "goals")).not.toContain(user.id);
  });

  it("one person's follows are not another's", async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    await follow(a.id, "FIXTURE", 4_000_001);
    expect(await listFollows(b.id)).toHaveLength(0);
    await db.follow.deleteMany({ where: { profileId: a.id } });
  });
});
