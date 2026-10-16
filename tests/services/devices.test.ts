import { describe, expect, it } from "vitest";

/**
 * The rule the device_tokens table encodes: the identifier belongs to an INSTALL, not a sign-in.
 *
 * It is unique, so registering again after a different user signs in moves the row rather than
 * adding a second one. Without that, a shared phone ends up subscribed for two people and the
 * previous user keeps getting alerts about teams they no longer follow, on a device that is no
 * longer theirs.
 */
describe("device registration", () => {
  /** The upsert the service performs, modelled over a map keyed by token. */
  class Devices {
    private rows = new Map<string, { userId: string; revokedAt: Date | null }>();

    register(userId: string, token: string) {
      this.rows.set(token, { userId, revokedAt: null });
    }

    unregister(token: string) {
      this.rows.delete(token);
    }

    revoke(token: string) {
      const row = this.rows.get(token);
      if (row) row.revokedAt = new Date();
    }

    liveFor(userId: string) {
      return [...this.rows.entries()]
        .filter(([, r]) => r.userId === userId && r.revokedAt === null)
        .map(([token]) => token);
    }

    get size() {
      return this.rows.size;
    }
  }

  it("re-registering the same install moves it to the new user", () => {
    const devices = new Devices();
    devices.register("alice", "install-1");
    devices.register("bob", "install-1");

    expect(devices.size).toBe(1);
    expect(devices.liveFor("alice")).toEqual([]);
    expect(devices.liveFor("bob")).toEqual(["install-1"]);
  });

  it("one account can hold several devices", () => {
    const devices = new Devices();
    devices.register("alice", "phone");
    devices.register("alice", "tablet");
    expect(devices.liveFor("alice").sort()).toEqual(["phone", "tablet"]);
  });

  it("signing out of one device leaves the others alone", () => {
    // Signing out of a phone says nothing about a tablet.
    const devices = new Devices();
    devices.register("alice", "phone");
    devices.register("alice", "tablet");
    devices.unregister("phone");
    expect(devices.liveFor("alice")).toEqual(["tablet"]);
  });

  it("a token Firebase rejects stops being addressed, without losing the row", () => {
    const devices = new Devices();
    devices.register("alice", "dead");
    devices.revoke("dead");
    expect(devices.liveFor("alice")).toEqual([]);
    expect(devices.size).toBe(1);
  });

  it("registering again after a revoke brings the device back", () => {
    const devices = new Devices();
    devices.register("alice", "install-1");
    devices.revoke("install-1");
    devices.register("alice", "install-1");
    expect(devices.liveFor("alice")).toEqual(["install-1"]);
  });
});
