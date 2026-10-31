import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * The checks that decide whether a Sign in with Apple is real.
 *
 * Built the same way as google-verify.test.ts: a real key pair, real signed tokens, and Apple's
 * key endpoint stubbed so jose fetches it exactly as it would the live one. Nothing here is
 * mocked at the verifier boundary, so a check that quietly stopped running would fail these.
 *
 * Apple differs from Google in three ways that each get their own test below: the audience is the
 * bundle identifier rather than a client id, the email arrives only on the first authorization,
 * and a nonce binds the token to one sign-in attempt.
 */
const AUD = "win.gameclaw.app";
const ISS = "https://appleid.apple.com";

let priv: CryptoKey;
let jwks: { keys: unknown[] };
let otherPriv: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test" }] };

  // A second key that Apple does not publish, for the forged-signature case.
  otherPriv = (await generateKeyPair("RS256", { extractable: true })).privateKey;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("appleid.apple.com")) {
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
      });
    }
    throw new Error(`unexpected fetch: ${input}`);
  });
});

const token = (
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: string; key?: CryptoKey } = {},
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? priv);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("a token Apple really issued for this app", () => {
  it("is accepted, and the address is lowercased", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(
      await token({ sub: "001234.abc.5678", email: "Someone@Example.com", email_verified: "true" }),
      AUD,
    );
    expect(id.subject).toBe("001234.abc.5678");
    // Lowercased because the address is matched against stored profiles, and case must not decide
    // whether two people are the same person.
    expect(id.email).toBe("someone@example.com");
    expect(id.emailVerified).toBe(true);
  });

  // Apple returns email on the first authorization only. A sign-in with no email claim is normal
  // and must still work - the subject is the durable identity, not the address.
  it("is accepted with no email at all, which is every sign-in after the first", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(await token({ sub: "001234.abc.5678" }), AUD);
    expect(id.subject).toBe("001234.abc.5678");
    expect(id.email).toBeNull();
    expect(id.emailVerified).toBe(false);
  });

  it("accepts a boolean email_verified as well as the string Apple sometimes sends", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const asBool = await verifyAppleIdToken(
      await token({ sub: "1", email: "a@b.com", email_verified: true }),
      AUD,
    );
    expect(asBool.emailVerified).toBe(true);
  });

  it("reports an unverified address as unverified rather than refusing the token", async () => {
    // Refusing outright would be wrong: the identity is still real. What must not happen is the
    // address being used to claim an existing profile, and that decision belongs to sign-in.ts,
    // which checks this flag.
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(
      await token({ sub: "1", email: "a@b.com", email_verified: false }),
      AUD,
    );
    expect(id.emailVerified).toBe(false);
  });
});

describe("private relay", () => {
  it("is recognised from the is_private_email claim", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(
      await token({
        sub: "1",
        email: "abc123@privaterelay.appleid.com",
        email_verified: "true",
        is_private_email: "true",
      }),
      AUD,
    );
    expect(id.isPrivateRelay).toBe(true);
  });

  // Belt and braces: Apple has sent the claim as a boolean, as a string, and the address itself is
  // unambiguous, so the address alone is enough.
  it("is recognised from the address even when the claim is absent", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(
      await token({ sub: "1", email: "abc123@privaterelay.appleid.com", email_verified: true }),
      AUD,
    );
    expect(id.isPrivateRelay).toBe(true);
  });

  it("does not flag an ordinary address", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(
      await token({ sub: "1", email: "someone@gmail.com", email_verified: true }),
      AUD,
    );
    expect(id.isPrivateRelay).toBe(false);
  });
});

describe("tokens that must be refused", () => {
  it("rejects one issued for a different app", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const other = await token({ sub: "1" }, { aud: "com.someone.else" });
    await expect(verifyAppleIdToken(other, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects one from a different issuer", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const other = await token({ sub: "1" }, { iss: "https://accounts.google.com" });
    await expect(verifyAppleIdToken(other, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects an expired one", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const old = await token({ sub: "1" }, { exp: "-1h" });
    await expect(verifyAppleIdToken(old, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects one signed with a key Apple does not publish", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const forged = await token({ sub: "1" }, { key: otherPriv });
    await expect(verifyAppleIdToken(forged, AUD)).rejects.toThrow(/could not be verified/);
  });

  it("rejects a token with no subject", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    await expect(verifyAppleIdToken(await token({ email: "a@b.com" }), AUD)).rejects.toThrow(
      /could not be verified/,
    );
  });

  // The one that matters most, and the one an unconfigured server gets wrong: passing an empty
  // audience to jwtVerify skips the audience check entirely, so any Apple token for any app would
  // be accepted as a GameClaw identity.
  it("refuses everything when no audience is configured, rather than skipping the check", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const good = await token({ sub: "1" });
    await expect(verifyAppleIdToken(good, "")).rejects.toThrow(/not configured/);
  });
});

describe("nonce, which binds a token to one sign-in attempt", () => {
  const raw = "a-random-value-the-client-invented";

  it("accepts the token when the raw value hashes to the claim", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(await token({ sub: "1", nonce: sha256(raw) }), AUD, raw);
    expect(id.subject).toBe("1");
  });

  it("rejects a different raw value", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const t = await token({ sub: "1", nonce: sha256(raw) });
    await expect(verifyAppleIdToken(t, AUD, "not-the-nonce")).rejects.toThrow(
      /could not be verified/,
    );
  });

  // A replayed token is exactly this case: the attacker has the token but not the value that
  // produced its nonce. If an absent raw value counted as a pass, the claim would be decorative
  // and replay would succeed by simply omitting it.
  it("rejects a token carrying a nonce when no raw value is supplied", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const t = await token({ sub: "1", nonce: sha256(raw) });
    await expect(verifyAppleIdToken(t, AUD)).rejects.toThrow(/could not be verified/);
    await expect(verifyAppleIdToken(t, AUD, null)).rejects.toThrow(/could not be verified/);
    await expect(verifyAppleIdToken(t, AUD, "")).rejects.toThrow(/could not be verified/);
  });

  it("is not fooled by the hash being sent where the raw value belongs", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const t = await token({ sub: "1", nonce: sha256(raw) });
    await expect(verifyAppleIdToken(t, AUD, sha256(raw))).rejects.toThrow(/could not be verified/);
  });

  // Apple permits omitting the nonce, and a token without one has still passed signature, issuer,
  // audience and expiry. Refusing it would break a client that chose not to send one; it is the
  // client's job to always send one, which ours will.
  it("accepts a token that carries no nonce at all", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const id = await verifyAppleIdToken(await token({ sub: "1" }), AUD, undefined);
    expect(id.subject).toBe("1");
  });
});

describe("the audiences this server will accept", () => {
  it("splits a comma-separated list and trims it", async () => {
    const { acceptedAppleAudiences } = await import("@/lib/identity/apple");
    expect(acceptedAppleAudiences("win.gameclaw.app, win.gameclaw.old ")).toEqual([
      "win.gameclaw.app",
      "win.gameclaw.old",
    ]);
  });

  // More than one, because a bundle identifier is baked into every installed build: the server has
  // to keep accepting the previous one until those copies are updated.
  it("accepts a token for an older bundle id still in the list", async () => {
    const { verifyAppleIdToken } = await import("@/lib/identity/apple");
    const old = await token({ sub: "1" }, { aud: "win.gameclaw.old" });
    const id = await verifyAppleIdToken(old, "win.gameclaw.app,win.gameclaw.old");
    expect(id.subject).toBe("1");
  });

  it("treats blanks and stray commas as absent rather than as an audience", async () => {
    const { acceptedAppleAudiences } = await import("@/lib/identity/apple");
    expect(acceptedAppleAudiences("")).toEqual([]);
    expect(acceptedAppleAudiences("  ")).toEqual([]);
    expect(acceptedAppleAudiences(",,")).toEqual([]);
  });
});
