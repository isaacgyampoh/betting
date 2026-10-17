import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { db } from "@/lib/db";
import { createUser } from "./helpers";

/**
 * How an administrator actually gets a session in a browser.
 *
 * This is the test that was missing, and its absence is why the dashboard shipped unreachable.
 * The existing admin tests minted the `gc_admin_session` cookie by hand and then asserted that a
 * request carrying it was let in - which passed, and proved nothing about whether a real person
 * could ever obtain one. Nothing in the application set that cookie at all.
 *
 * So these drive the endpoint that issues it, and assert on what it returns rather than on what
 * a fixture supplied.
 */
const AUD = "400646694915-test.apps.googleusercontent.com";
const ISS = "https://accounts.google.com";

let priv: CryptoKey;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET ??= "a-test-signing-secret-of-sufficient-length-00";
  process.env.GOOGLE_WEB_CLIENT_ID = AUD;

  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey;
  const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test" }] };
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

const googleToken = (claims: Record<string, unknown>) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(priv);

/** The cookie jar the route writes into, captured so the test can read what was set. */
const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const row = jar.get(name);
      return row ? { name, value: row.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
}));

async function post(credential: string) {
  const { POST } = await import("@/app/api/v1/auth/admin-session/route");
  const req = new Request("https://admin.gameclaw.win/api/v1/auth/admin-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  req.nextUrl = new URL("https://admin.gameclaw.win/api/v1/auth/admin-session");
  return POST(req, { params: Promise.resolve({}) });
}

async function makeAdminWithGoogle(subject: string) {
  const user = await createUser();
  await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  await db.identity.create({
    data: { profileId: user.id, provider: "google", subject, email: user.email },
  });
  return user;
}

describe("signing in to the dashboard from a browser", () => {
  it("sets a session cookie for an administrator", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-admin`;
    const user = await makeAdminWithGoogle(subject);

    const res = await post(await googleToken({ sub: subject, email: user.email, email_verified: true }));
    expect(res.status).toBe(200);

    // The whole point: a real request produced a usable cookie.
    const cookie = jar.get("gc_admin_session");
    expect(cookie).toBeDefined();

    const { readAccessToken } = await import("@/lib/identity/session");
    expect((await readAccessToken(cookie!.value))?.id).toBe(user.id);
  });

  it("sets it httpOnly, secure and same-site, so script cannot lift it", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-flags`;
    const user = await makeAdminWithGoogle(subject);
    await post(await googleToken({ sub: subject, email: user.email, email_verified: true }));

    const options = jar.get("gc_admin_session")!.options;
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("lax");
  });

  it("refuses an ordinary user, and sets no cookie", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-user`;
    const user = await createUser();
    await db.identity.create({
      data: { profileId: user.id, provider: "google", subject, email: user.email },
    });

    const res = await post(
      await googleToken({ sub: subject, email: user.email, email_verified: true }),
    );
    expect(res.status).toBe(403);
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });

  it("refuses a Google account with no profile here", async () => {
    jar.clear();
    const res = await post(
      await googleToken({ sub: "nobody-at-all", email: "stranger@example.com", email_verified: true }),
    );
    expect(res.status).toBe(403);
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });

  it("refuses a suspended administrator", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-susp`;
    const user = await makeAdminWithGoogle(subject);
    await db.profile.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    const res = await post(
      await googleToken({ sub: subject, email: user.email, email_verified: true }),
    );
    expect(res.status).toBe(403);
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });

  it("will not match an administrator on an unverified email", async () => {
    jar.clear();
    const user = await createUser();
    await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    // No identity row, so the only route in is the email fallback - which must refuse to act on
    // an address Google has not confirmed the signer controls.
    const res = await post(
      await googleToken({ sub: "unverified-sub", email: user.email, email_verified: false }),
    );
    expect(res.status).toBe(403);
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });

  it("links an administrator who has never signed in on a device, by verified email", async () => {
    jar.clear();
    const user = await createUser();
    await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });

    const res = await post(
      await googleToken({ sub: `sub-${Date.now()}-link`, email: user.email, email_verified: true }),
    );
    expect(res.status).toBe(200);
    expect(jar.get("gc_admin_session")).toBeDefined();
  });

  it("refuses a token minted for another application", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-aud`;
    const user = await makeAdminWithGoogle(subject);
    const wrongAudience = await new SignJWT({
      sub: subject,
      email: user.email,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(ISS)
      .setAudience("someone-else.apps.googleusercontent.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(priv);

    const res = await post(wrongAudience);
    // Rejected by the Google verifier before any account is looked up.
    expect(res.status).toBe(401);
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });

  it("signing out clears the cookie", async () => {
    jar.clear();
    const subject = `sub-${Date.now()}-out`;
    const user = await makeAdminWithGoogle(subject);
    await post(await googleToken({ sub: subject, email: user.email, email_verified: true }));
    expect(jar.get("gc_admin_session")).toBeDefined();

    const { DELETE } = await import("@/app/api/v1/auth/admin-session/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new Request("https://admin.gameclaw.win/api/v1/auth/admin-session", {
      method: "DELETE",
    }) as any;
    req.nextUrl = new URL("https://admin.gameclaw.win/api/v1/auth/admin-session");
    await DELETE(req, { params: Promise.resolve({}) });
    expect(jar.get("gc_admin_session")).toBeUndefined();
  });
});
