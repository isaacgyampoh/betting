import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { getAdmin, requireAdmin } from "@/lib/identity/admin";
import { issueSession, readAccessToken, rotateSession } from "@/lib/identity/session";
import { listUsers, overview, reactivateUser, suspendUser, userDetail } from "@/lib/services/admin";
import { createUser } from "./helpers";

beforeAll(() => {
  process.env.AUTH_JWT_SECRET ??= "a-test-signing-secret-of-sufficient-length-00";
});

async function makeAdmin() {
  const user = await createUser();
  await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  return user;
}

const bearer = async (id: string, email: string | null, role: "USER" | "ADMIN") =>
  `Bearer ${(await issueSession({ id, email, role })).accessToken}`;

describe("who gets into the admin dashboard", () => {
  it("lets an admin in", async () => {
    const admin = await makeAdmin();
    const who = await getAdmin(await bearer(admin.id, admin.email, "ADMIN"));
    expect(who?.id).toBe(admin.id);
  });

  it("keeps an ordinary user out", async () => {
    const user = await createUser();
    expect(await getAdmin(await bearer(user.id, user.email, "USER"))).toBeNull();
    await expect(requireAdmin(await bearer(user.id, user.email, "USER"))).rejects.toThrow();
  });

  it("keeps out a request with no token at all", async () => {
    expect(await getAdmin(null)).toBeNull();
    expect(await getAdmin("Bearer not-a-token")).toBeNull();
  });

  /**
   * The one that matters. The role claim is inside a token the holder possesses, so if the guard
   * trusted it, anybody who could obtain a signed token for themselves could claim to be an
   * admin. The guard reads the role from the database instead.
   */
  it("does not believe a role claim in the token", async () => {
    const user = await createUser();
    // A perfectly valid, correctly signed GameClaw token - that says ADMIN for a USER account.
    const forged = await new SignJWT({ email: user.email, role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("gameclaw")
      .setAudience("gameclaw-app")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));

    // The token itself is genuine and reads back as ADMIN...
    expect((await readAccessToken(forged))?.role).toBe("ADMIN");
    // ...and the guard still refuses, because it asks the database.
    expect(await getAdmin(`Bearer ${forged}`)).toBeNull();
  });

  it("stops honouring a token once the role is taken away", async () => {
    const admin = await makeAdmin();
    const token = await bearer(admin.id, admin.email, "ADMIN");
    expect(await getAdmin(token)).not.toBeNull();

    await db.profile.update({ where: { id: admin.id }, data: { role: "USER" } });
    // The token is still cryptographically valid and still says ADMIN. It no longer works, which
    // is why the database is consulted on every admin request rather than once per hour.
    expect(await getAdmin(token)).toBeNull();
  });

  it("keeps out a suspended admin", async () => {
    const admin = await makeAdmin();
    const token = await bearer(admin.id, admin.email, "ADMIN");
    await db.profile.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
    expect(await getAdmin(token)).toBeNull();
  });
});

describe("suspending an account", () => {
  it("blocks the account, ends every session, and writes an audit row", async () => {
    const admin = await makeAdmin();
    const victim = await createUser();
    const phone = await issueSession({ id: victim.id, email: victim.email, role: "USER" });
    const tablet = await issueSession({ id: victim.id, email: victim.email, role: "USER" });

    const { revoked } = await suspendUser(admin.id, victim.id, "chargebacks");
    expect(revoked).toBe(2);

    // A suspension that leaves live sessions running is not a suspension.
    await expect(rotateSession(phone.refreshToken)).rejects.toThrow();
    await expect(rotateSession(tablet.refreshToken)).rejects.toThrow();

    const entry = await db.adminAudit.findFirst({
      where: { action: "user.suspend", target: victim.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.actorId).toBe(admin.id);
    expect(entry?.detail).toMatchObject({ reason: "chargebacks", sessionsRevoked: 2 });
  });

  it("refuses to let an admin suspend themselves", async () => {
    const admin = await makeAdmin();
    await expect(suspendUser(admin.id, admin.id, "oops")).rejects.toThrow(/your own account/);
  });

  it("reactivating clears the block but does not resurrect old sessions", async () => {
    const admin = await makeAdmin();
    const victim = await createUser();
    const session = await issueSession({ id: victim.id, email: victim.email, role: "USER" });

    await suspendUser(admin.id, victim.id, "mistake");
    await reactivateUser(admin.id, victim.id);

    const after = await db.profile.findUnique({ where: { id: victim.id } });
    expect(after?.suspendedAt).toBeNull();
    // Revoked is final. They sign in again.
    await expect(rotateSession(session.refreshToken)).rejects.toThrow();
  });
});

describe("the dashboard's queries", () => {
  it("counts without loading rows", async () => {
    await createUser();
    const stats = await overview();
    expect(stats.users.total).toBeGreaterThan(0);
    // The recent list is a fixed window, not the table.
    expect(stats.recent.length).toBeLessThanOrEqual(8);
  });

  it("paginates and clamps the page size a caller asks for", async () => {
    for (let i = 0; i < 6; i++) await createUser();
    const page = await listUsers({ page: 1, take: 5 });
    expect(page.users).toHaveLength(5);
    expect(page.pages).toBeGreaterThan(1);

    // A caller asking for everything gets the ceiling, not everything.
    const greedy = await listUsers({ take: 10_000 });
    expect(greedy.take).toBe(50);
  });

  it("finds a user by email fragment and by exact id", async () => {
    const user = await createUser(`findme-${Date.now()}@example.com`);
    expect((await listUsers({ search: "findme-" })).total).toBeGreaterThan(0);
    const byId = await listUsers({ search: user.id });
    expect(byId.users.some((u) => u.id === user.id)).toBe(true);
  });

  it("does not fall over when the search text is not a uuid", async () => {
    // A uuid comparison against arbitrary text is an error, not a miss, so the id branch is
    // only added when the needle looks like one.
    await expect(listUsers({ search: "not-a-uuid-at-all" })).resolves.toBeTruthy();
  });

  it("never exposes a session token in user detail", async () => {
    const user = await createUser();
    await issueSession({ id: user.id, email: user.email, role: "USER" });
    const detail = await userDetail(user.id);

    expect(detail.sessions.length).toBe(1);
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toMatch(/tokenHash/);
    // And nothing that looks like a stored hash leaked through another field.
    expect(serialised).not.toMatch(/\b[0-9a-f]{64}\b/);
  });
});
