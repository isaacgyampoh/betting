import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * The checks that decide whether a Google sign-in is real.
 *
 * Each of these is a way in if it is missing, and the one that bites hardest is the audience:
 * a token Google issued for somebody else's application is correctly signed by Google and will
 * pass every other check. Without an audience check, any app whose users also use GameClaw could
 * sign in as them.
 */
const AUD = "400646694915-test.apps.googleusercontent.com";
const ISS = "https://accounts.google.com";

let priv: CryptoKey;
let jwks: { keys: unknown[] };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test" }] };

  // Stand in for Google's key endpoint. jose fetches it exactly as it would the real one.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("googleapis.com")) {
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
      });
    }
    throw new Error(`unexpected fetch: ${input}`);
  });
});

const token = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(priv);

describe("verifying a Google ID token", () => {
  it("accepts a properly signed token for this application", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const id = await verifyGoogleIdToken(
      await token({ sub: "1234567890", email: "Someone@Gmail.com", email_verified: true, name: "Someone" }),
      AUD,
    );
    expect(id.subject).toBe("1234567890");
    // Lowercased, because an address is matched against stored profiles and case must not decide.
    expect(id.email).toBe("someone@gmail.com");
    expect(id.emailVerified).toBe(true);
  });

  it("rejects a token issued for a different application", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const other = await token({ sub: "1", email_verified: true }, { aud: "someone-else.apps.googleusercontent.com" });
    await expect(verifyGoogleIdToken(other, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects a token from a different issuer", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const bad = await token({ sub: "1", email_verified: true }, { iss: "https://evil.example" });
    await expect(verifyGoogleIdToken(bad, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects an expired token", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const old = await token({ sub: "1", email_verified: true }, { exp: "-10m" });
    await expect(verifyGoogleIdToken(old, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects a token signed by the wrong key", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const impostor = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ sub: "1", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("1h")
      .sign(impostor.privateKey);
    await expect(verifyGoogleIdToken(forged, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("refuses to verify at all when no audience is configured", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    // The dangerous case: passing an empty audience to jose skips the check entirely, so a
    // missing environment variable would silently accept every application's tokens.
    await expect(verifyGoogleIdToken(await token({ sub: "1" }), "")).rejects.toThrow(/not configured/);
  });

  it("reports an unverified email as unverified rather than dropping it", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const id = await verifyGoogleIdToken(
      await token({ sub: "2", email: "unverified@gmail.com", email_verified: false }),
      AUD,
    );
    // The caller decides what to do with it; what matters is that it is not reported as verified,
    // because linking an existing account on an unverified address is account takeover.
    expect(id.emailVerified).toBe(false);
    expect(id.email).toBe("unverified@gmail.com");
  });
});

/**
 * Several accepted audiences at once.
 *
 * A client id is baked into every installed APK, so replacing the Web client - which happened
 * here, the first one was deleted - would reject every build in the field the moment the server
 * moved on. Listing both lets installed apps keep working while new ones use the new id.
 */
describe("accepting more than one audience", () => {
  const NEW = "400646694915-new.apps.googleusercontent.com";

  it("accepts a token for either configured client", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const both = `${AUD},${NEW}`;

    const forOld = await token({ sub: "1", email_verified: true });
    expect((await verifyGoogleIdToken(forOld, both)).subject).toBe("1");

    const forNew = await token({ sub: "2", email_verified: true }, { aud: NEW });
    expect((await verifyGoogleIdToken(forNew, both)).subject).toBe("2");
  });

  it("still refuses an audience that is not on the list", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const other = await token({ sub: "3" }, { aud: "someone-else.apps.googleusercontent.com" });
    await expect(verifyGoogleIdToken(other, `${AUD},${NEW}`)).rejects.toThrow(/could not be verified/);
  });

  it("tolerates whitespace and trailing commas in the configuration", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const t = await token({ sub: "4", email_verified: true });
    expect((await verifyGoogleIdToken(t, ` ${AUD} , ${NEW} , `)).subject).toBe("4");
  });

  it("refuses everything when the list is empty or only separators", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity/google");
    const t = await token({ sub: "5" });
    await expect(verifyGoogleIdToken(t, " , , ")).rejects.toThrow(/not configured/);
  });
});
