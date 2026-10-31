import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { db } from "@/lib/db";

/**
 * Which account a Sign in with Apple lands on.
 *
 * The verifier tests in tests/identity/apple-verify.test.ts prove a token is genuine. This file
 * asks the next question, which is the one that can lose somebody their account: given a genuine
 * token, does it reach the right profile, and does it ever reach the wrong one?
 *
 * Case 2 in lib/identity/sign-in.ts - matching a verified address to an existing profile - is how
 * an attacker takes over an account if it is got wrong: sign up to any identity provider with
 * somebody else's address and claim their profile. It is safe only because the address comes from
 * a token whose signature, audience and `email_verified` have all been checked. The test that
 * matters most below is the one asserting an *unverified* address does not link.
 *
 * Runs against the disposable Postgres the rest of tests/integration uses. Every profile here is
 * created by the test and identified by a unique address, so nothing touches real data.
 */
const AUD = "win.gameclaw.app";
const ISS = "https://appleid.apple.com";

let priv: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey;
  const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test" }] };

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("appleid.apple.com")) {
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
      });
    }
    throw new Error(`unexpected fetch: ${input}`);
  });

  process.env.APPLE_BUNDLE_ID = AUD;
  process.env.AUTH_JWT_SECRET ??= "integration-test-secret-integration-test-secret";
});

const appleToken = (claims: Record<string, unknown>) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(priv);

/** A profile as it would exist from an earlier Google sign-in. */
async function googleProfile(email: string) {
  return db.profile.create({
    data: {
      id: randomUUID(),
      email,
      displayName: "Existing Person",
      identities: { create: { provider: "google", subject: `google-${randomUUID()}`, email } },
    },
    select: { id: true, email: true },
  });
}

const identitiesFor = (profileId: string) =>
  db.identity.findMany({ where: { profileId }, select: { provider: true, subject: true } });

describe("an Apple sign-in that should join an existing account", () => {
  it("links to the profile already holding that verified address, rather than making a second one", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const email = `linked-${randomUUID()}@example.com`;
    const existing = await googleProfile(email);

    const sub = `apple-${randomUUID()}`;
    const result = await signInWithApple(await appleToken({ sub, email, email_verified: "true" }));

    expect(result.isNew).toBe(false);

    // The same profile, now reachable by either provider.
    const providers = (await identitiesFor(existing.id)).map((i) => i.provider).sort();
    expect(providers).toEqual(["apple", "google"]);

    // And exactly one profile holds that address - the failure this guards against is a silent
    // second account that looks fine until the user asks where their slips went.
    const count = await db.profile.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("returns to the same profile on a later sign-in, without linking twice", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const email = `repeat-${randomUUID()}@example.com`;
    const existing = await googleProfile(email);
    const sub = `apple-${randomUUID()}`;

    await signInWithApple(await appleToken({ sub, email, email_verified: "true" }));
    // Apple omits the address on every sign-in after the first, so the second token carries none.
    await signInWithApple(await appleToken({ sub }));

    const apple = (await identitiesFor(existing.id)).filter((i) => i.provider === "apple");
    expect(apple).toHaveLength(1);
    expect(await db.profile.count({ where: { email } })).toBe(1);
  });
});

describe("an Apple sign-in that must NOT join an existing account", () => {
  // The security test. If this ever passes by linking, anyone can take over an account by
  // presenting an unverified address that happens to match it.
  it("does not claim a profile when Apple has not verified the address", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const email = `unverified-${randomUUID()}@example.com`;
    const existing = await googleProfile(email);

    const result = await signInWithApple(
      await appleToken({ sub: `apple-${randomUUID()}`, email, email_verified: false }),
    );

    expect(result.isNew).toBe(true);

    // The existing profile is untouched: still Google-only.
    const providers = (await identitiesFor(existing.id)).map((i) => i.provider);
    expect(providers).toEqual(["google"]);
  });

  // Documented behaviour rather than a defect, and worth pinning so nobody "fixes" it later by
  // matching on something weaker. Hide My Email gives a per-app relay address that matches nothing
  // we hold, so there is nothing to link to - which is the entire point of the relay.
  it("creates a separate account for a private relay address", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const real = `relay-owner-${randomUUID()}@example.com`;
    const existing = await googleProfile(real);
    const relay = `${randomUUID().slice(0, 8)}@privaterelay.appleid.com`;

    const result = await signInWithApple(
      await appleToken({ sub: `apple-${randomUUID()}`, email: relay, email_verified: "true" }),
    );

    expect(result.isNew).toBe(true);
    expect((await identitiesFor(existing.id)).map((i) => i.provider)).toEqual(["google"]);
    expect(await db.profile.count({ where: { email: relay } })).toBe(1);
  });
});

describe("a brand new Apple user", () => {
  it("gets one profile and one identity, not a duplicate on each sign-in", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const email = `new-${randomUUID()}@example.com`;
    const sub = `apple-${randomUUID()}`;

    const first = await signInWithApple(await appleToken({ sub, email, email_verified: "true" }));
    expect(first.isNew).toBe(true);

    const second = await signInWithApple(await appleToken({ sub }));
    expect(second.isNew).toBe(false);

    expect(await db.profile.count({ where: { email } })).toBe(1);
    expect(await db.identity.count({ where: { provider: "apple", subject: sub } })).toBe(1);
  });

  it("refuses a suspended account rather than issuing a session", async () => {
    const { signInWithApple } = await import("@/lib/identity/sign-in");
    const email = `suspended-${randomUUID()}@example.com`;
    const sub = `apple-${randomUUID()}`;
    await signInWithApple(await appleToken({ sub, email, email_verified: "true" }));
    await db.profile.updateMany({ where: { email }, data: { suspendedAt: new Date() } });

    await expect(signInWithApple(await appleToken({ sub }))).rejects.toThrow(/suspended/i);
  });
});
