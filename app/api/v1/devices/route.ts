import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { registerDevice, unregisterDevice } from "@/lib/services/devices";

// An FCM registration token. Long and opaque; bounded so a bad client cannot post a novel.
const tokenSchema = z.string().trim().min(32).max(4096);

const registerSchema = z.object({
  token: tokenSchema,
  platform: z.enum(["android", "ios"]).default("android"),
});

/**
 * Registers this device for push, against the signed-in user.
 *
 * requireUser rather than requireAdult on purpose: a device registers as soon as the app has a
 * session, and the 18+ confirmation is a separate gate on football content. Refusing registration
 * until it is given would mean a user who confirms later never gets a token until they restart.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  const body = await parseBody(req, registerSchema);
  await registerDevice(user, body.token, body.platform);
  return ok({ registered: true });
});

/**
 * Removes this device's registration. Called on sign-out.
 *
 * Only this token: other devices on the account keep theirs, because signing out of a phone says
 * nothing about a tablet.
 */
export const DELETE = route(async (req) => {
  await requireUser(req.headers.get("authorization"));
  const { token } = await parseBody(req, z.object({ token: tokenSchema }));
  await unregisterDevice(token);
  return ok({ registered: false });
});
