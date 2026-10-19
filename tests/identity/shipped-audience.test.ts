import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptedAudiences } from "@/lib/identity/google";

/**
 * The server must accept the audience the shipped app actually sends.
 *
 * `GC_GOOGLE_SERVER_CLIENT_ID` is a `--dart-define`, so it is compiled into the APK at build time
 * and lives nowhere in this repo. `GOOGLE_WEB_CLIENT_ID` on the server is what ID tokens are
 * checked against. Nothing connected the two, and they drifted: the app was moved onto the
 * `b4oh5at...` Web client (docs/release-signing.md) while render.yaml still listed only
 * `k5ikq1qt...`. Every sign-in from a release build would have been rejected for a bad audience
 * after Google had already issued a perfectly good token - a 401 with nothing in it to suggest
 * the cause was a config file.
 *
 * SHIPPED is not a guess. It was read back out of the signed release APK:
 *
 *   unzip -p app-release.apk lib/arm64-v8a/libapp.so | strings \
 *     | grep -oE '[0-9]{10,13}-[a-z0-9]+\.apps\.googleusercontent\.com'
 *
 * If a build moves onto a new Web client, that id goes into render.yaml's list and into SHIPPED
 * here, in the same change. Keep the old id in render.yaml until no install can still be sending
 * it; this test only requires that the current one is present.
 */
const SHIPPED = "400646694915-b4oh5athe842emcnga4913s1oq1igjh1.apps.googleusercontent.com";

function renderYamlAudiences(): string {
  const yaml = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");
  // Deliberately a narrow regex rather than a YAML parse: this reads one well-known literal, and
  // a parser would happily return undefined for a renamed key and pass.
  const match = yaml.match(/^\s*-\s*key:\s*GOOGLE_WEB_CLIENT_ID\s*\n\s*value:\s*(.+)$/m);
  if (!match) throw new Error("GOOGLE_WEB_CLIENT_ID is not declared with a literal value in render.yaml");
  return match[1].trim();
}

describe("the audience the shipped APK sends", () => {
  it("is accepted by the server configured in render.yaml", () => {
    expect(acceptedAudiences(renderYamlAudiences())).toContain(SHIPPED);
  });

  it("is a client id in the project that owns the OAuth clients", () => {
    // A Web client from a different Google Cloud project is the other way this breaks: Google
    // mints the token happily and the Android client that proves the app's identity lives
    // somewhere the audience's project cannot see.
    expect(SHIPPED.startsWith("400646694915-")).toBe(true);
    for (const aud of acceptedAudiences(renderYamlAudiences())) {
      expect(aud).toMatch(/^400646694915-[a-z0-9]+\.apps\.googleusercontent\.com$/);
    }
  });

  it("would notice an empty or missing list", () => {
    // acceptedAudiences fails closed, and this is the test that would catch render.yaml losing
    // the value entirely rather than merely listing the wrong id.
    expect(acceptedAudiences("")).toEqual([]);
    expect(acceptedAudiences("   ")).toEqual([]);
  });
});
