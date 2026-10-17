import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import {
  issueSession,
  readAccessToken,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from "@/lib/identity/session";
import { createUser } from "./helpers";

beforeAll(() => {
  process.env.AUTH_JWT_SECRET ??= "a-test-signing-secret-of-sufficient-length-00";
});

const claimsFor = (id: string, email: string) =>
  ({ id, email, role: "USER" }) as const;

describe("GameClaw's own sessions", () => {
  it("issues a token that reads back as the same person", async () => {
    const user = await createUser();
    const session = await issueSession(claimsFor(user.id, user.email));
    const read = await readAccessToken(session.accessToken);
    expect(read?.id).toBe(user.id);
    expect(read?.email).toBe(user.email);
  });

  it("stores the refresh token only as a hash", async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(claimsFor(user.id, user.email));
    const rows = await db.refreshToken.findMany({ where: { profileId: user.id } });
    expect(rows).toHaveLength(1);
    // The point of the whole design: a stolen database dump is not a set of working sessions.
    expect(rows[0]!.tokenHash).not.toBe(refreshToken);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a token signed with a different secret", async () => {
    const user = await createUser();
    // Forged rather than re-pointing AUTH_JWT_SECRET, because env() caches the parsed
    // environment for the process - so changing the variable mid-test proved nothing and the
    // first version of this test passed a token that should have failed.
    const forged = await new SignJWT({ email: user.email, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("gameclaw")
      .setAudience("gameclaw-app")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-also-long-enough"));
    expect(await readAccessToken(forged)).toBeNull();
  });

  it("rejects a token minted for a different audience", async () => {
    const user = await createUser();
    const wrongAudience = await new SignJWT({ email: user.email, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("gameclaw")
      .setAudience("somebody-else")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
    expect(await readAccessToken(wrongAudience)).toBeNull();
  });

  it("rejects an expired access token", async () => {
    const user = await createUser();
    const stale = await new SignJWT({ email: user.email, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("gameclaw")
      .setAudience("gameclaw-app")
      .setIssuedAt()
      .setExpirationTime("-5m")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
    expect(await readAccessToken(stale)).toBeNull();
  });

  it("rotates: the old token stops working and a new one starts", async () => {
    const user = await createUser();
    const first = await issueSession(claimsFor(user.id, user.email));
    const second = await rotateSession(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(await readAccessToken(second.accessToken)).not.toBeNull();
    // Rotation revokes what was presented.
    await expect(rotateSession(first.refreshToken)).rejects.toThrow(/sign in again/);
  });

  /**
   * The behaviour the design exists for. A refresh token used twice has been copied, because the
   * legitimate holder discarded theirs when it rotated. There is no way to tell the thief from
   * the owner, so both are signed out.
   */
  it("treats a reused refresh token as theft and kills the whole family", async () => {
    const user = await createUser();
    const first = await issueSession(claimsFor(user.id, user.email));
    const second = await rotateSession(first.refreshToken);
    const third = await rotateSession(second.refreshToken);

    // The attacker replays the token they copied two rotations ago.
    await expect(rotateSession(first.refreshToken)).rejects.toThrow(/sign in again/);

    // And the legitimate holder's current token is dead too. That is the intended cost.
    await expect(rotateSession(third.refreshToken)).rejects.toThrow(/sign in again/);

    const live = await db.refreshToken.count({ where: { profileId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it("does not sign out other devices when one session is rotated", async () => {
    const user = await createUser();
    const phone = await issueSession(claimsFor(user.id, user.email));
    const tablet = await issueSession(claimsFor(user.id, user.email));

    await rotateSession(phone.refreshToken);
    // A separate sign-in is a separate family, so the tablet is untouched.
    await expect(rotateSession(tablet.refreshToken)).resolves.toBeTruthy();
  });

  it("signs out one device without touching the others", async () => {
    const user = await createUser();
    const phone = await issueSession(claimsFor(user.id, user.email));
    const tablet = await issueSession(claimsFor(user.id, user.email));

    await revokeSession(phone.refreshToken);
    await expect(rotateSession(phone.refreshToken)).rejects.toThrow();
    await expect(rotateSession(tablet.refreshToken)).resolves.toBeTruthy();
  });

  it("signing out everywhere ends every session", async () => {
    const user = await createUser();
    const a = await issueSession(claimsFor(user.id, user.email));
    const b = await issueSession(claimsFor(user.id, user.email));
    expect(await revokeAllSessions(user.id)).toBe(2);
    await expect(rotateSession(a.refreshToken)).rejects.toThrow();
    await expect(rotateSession(b.refreshToken)).rejects.toThrow();
  });

  it("refuses to refresh a suspended account", async () => {
    const user = await createUser();
    const session = await issueSession(claimsFor(user.id, user.email));
    await db.profile.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    await expect(rotateSession(session.refreshToken)).rejects.toThrow(/suspended/);
  });

  it("refuses an expired refresh token", async () => {
    const user = await createUser();
    const session = await issueSession(claimsFor(user.id, user.email));
    await db.refreshToken.updateMany({
      where: { profileId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(rotateSession(session.refreshToken)).rejects.toThrow(/sign in again/);
  });

  it("refuses a refresh token that was never issued", async () => {
    await expect(rotateSession("not-a-real-token-but-long-enough-to-pass")).rejects.toThrow();
  });
});
