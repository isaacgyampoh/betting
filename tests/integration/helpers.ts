import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/** Creates an auth user (the DB trigger creates the profile) with age confirmed. */
export async function createUser(email = `test-${randomUUID().slice(0, 8)}@example.com`) {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${id}::uuid, ${email}, '{"full_name":"Test User"}'::jsonb)`;
  await db.profile.update({ where: { id }, data: { ageConfirmedAt: new Date() } });
  return { id, email };
}
