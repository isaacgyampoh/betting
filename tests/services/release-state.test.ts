import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The website must not invent a place to download the app.
 *
 * A Google Play button for an app that has not been published 404s for everyone who taps it, and
 * it is the easiest possible thing to add "just for now" during a launch and then ship. So the
 * destination is read from the environment, and the page shows a button only once the address it
 * points at actually exists.
 */

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.resetModules();
});

async function release() {
  vi.resetModules();
  const { androidRelease } = await import("@/lib/release");
  return androidRelease();
}

describe("where the Android app can be got", () => {
  it("offers nothing while the app is unpublished", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APK_URL", "");
    expect(await release()).toEqual({ kind: "unreleased" });
  });

  it("treats a blank or whitespace value as unset", async () => {
    // An env var set to an empty string in a dashboard is the same as not setting it, and reads
    // as present to a naive check - which would render a button pointing at "".
    vi.stubEnv("NEXT_PUBLIC_PLAY_URL", "   ");
    vi.stubEnv("NEXT_PUBLIC_APK_URL", "  ");
    expect(await release()).toEqual({ kind: "unreleased" });
  });

  it("offers a test build when one is hosted, and says it is a test build", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APK_URL", "https://example.com/gameclaw.apk");
    expect(await release()).toEqual({ kind: "testing", url: "https://example.com/gameclaw.apk" });
  });

  it("prefers the Play listing once it exists", async () => {
    // A direct APK usually stays up after launch. The store is the right destination from then on.
    vi.stubEnv("NEXT_PUBLIC_PLAY_URL", "https://play.google.com/store/apps/details?id=win.gameclaw.app");
    vi.stubEnv("NEXT_PUBLIC_APK_URL", "https://example.com/gameclaw.apk");
    const r = await release();
    expect(r.kind).toBe("play");
    expect(r).toHaveProperty("url", "https://play.google.com/store/apps/details?id=win.gameclaw.app");
  });

  it("never produces a Play URL that was not configured", async () => {
    // The whole point: no default, no guess, no constructed store link from the package name.
    vi.stubEnv("NEXT_PUBLIC_PLAY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APK_URL", "");
    expect(JSON.stringify(await release())).not.toContain("play.google.com");
  });
});
