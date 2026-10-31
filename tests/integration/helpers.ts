import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Creates a profile with age confirmed.
 *
 * This used to insert into `auth.users` and let the Supabase trigger `on_auth_user_created` mirror
 * the row into `profiles`. That trigger - and the `profiles.id -> auth.users.id` foreign key it
 * went with - were dropped in 20261030120000_drop_supabase_coupling, because they were breaking
 * every new signup in production: nothing writes to auth.users since Supabase was retired, so the
 * foreign key made `db.profile.create` with a fresh UUID impossible.
 *
 * So the profile is created directly now, which is also what the application itself does. Going
 * through a trigger meant the harness exercised a path production no longer takes.
 */
export async function createUser(email = `test-${randomUUID().slice(0, 8)}@example.com`) {
  const id = randomUUID();
  await db.profile.create({
    data: { id, email, displayName: "Test User", ageConfirmedAt: new Date() },
  });
  return { id, email };
}
