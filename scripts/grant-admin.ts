/**
 * Grants or revokes admin rights. The only way an account becomes an administrator.
 *
 *   DIRECT_URL=... pnpm admin:grant --email you@example.com
 *   DIRECT_URL=... pnpm admin:grant --email you@example.com --revoke
 *   DIRECT_URL=... pnpm admin:grant --list
 *
 * Deliberately a command run by somebody holding the database credential, not a web route.
 *
 * The alternative - a setup page that promotes the first visitor, or a seeded default login - is
 * the standard way self-hosted dashboards get taken over: the window between deploy and setup is
 * public, and nobody remembers to close it. There is no such window here. Before this script is
 * run there are no administrators and no way to become one from outside.
 *
 * It grants to an account that already exists; it does not create one. Sign in with Google
 * first, then run this against the address you signed in with.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | true | null => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : (args[i + 1] ?? true);
  };

  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DIRECT_URL (or DATABASE_URL) to the database to act on.");
    process.exit(1);
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    if (flag("list")) {
      const admins = await db.profile.findMany({
        where: { role: "ADMIN" },
        select: { id: true, email: true, lastSignInAt: true, suspendedAt: true },
        orderBy: { email: "asc" },
      });
      if (!admins.length) {
        console.log("No administrators. Nobody can open the dashboard.");
      } else {
        console.log(`${admins.length} administrator(s):`);
        for (const a of admins) {
          const when = a.lastSignInAt ? a.lastSignInAt.toISOString().slice(0, 10) : "never";
          console.log(`  ${a.email ?? "(no email)"}  last sign-in ${when}${a.suspendedAt ? "  SUSPENDED" : ""}`);
        }
      }
      process.exit(0);
    }

    const email = flag("email");
    if (typeof email !== "string") {
      console.error("Usage: --email <address> [--revoke] | --list");
      process.exit(1);
    }

    const profile = await db.profile.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, role: true },
    });

    if (!profile) {
      // Not created here on purpose. A profile invented by this script would have no identity
      // attached, so nobody could ever sign in to it - an admin account that exists and cannot be
      // used is worse than a clear error.
      console.error(`No account with that address. Sign in with Google as ${email} first, then run this again.`);
      process.exit(1);
    }

    const revoking = Boolean(flag("revoke"));
    const role = revoking ? "USER" : "ADMIN";

    if (profile.role === role) {
      console.log(`${profile.email} is already ${role}. Nothing to do.`);
      process.exit(0);
    }

    await db.profile.update({ where: { id: profile.id }, data: { role } });

    // Recorded in the same trail as every other administrative change, attributed to the account
    // itself: a grant made from a shell has no signed-in actor, and leaving it out of the trail
    // entirely would mean the most privileged action in the system is the one not written down.
    await db.adminAudit.create({
      data: {
        actorId: profile.id,
        action: revoking ? "admin.revoke" : "admin.grant",
        target: profile.id,
        detail: { via: "scripts/grant-admin.ts", from: profile.role, to: role },
      },
    });

    console.log(`${profile.email} is now ${role}.`);
    if (!revoking) console.log("They must sign out and back in for the change to reach their session.");
  } finally {
    await db.$disconnect();
  }
}

main();
