import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { follow, listFollows, setMuted, unfollow } from "@/lib/services/follows";

const kind = z.enum(["FIXTURE", "TEAM", "COMPETITION"]);

const alertsSchema = z
  .object({
    kickoff: z.boolean(),
    goals: z.boolean(),
    redCards: z.boolean(),
    halfTime: z.boolean(),
    fullTime: z.boolean(),
  })
  .partial();

const followSchema = z.object({
  kind,
  // The provider's ids are positive integers. Bounded so a bad client cannot post something that
  // will not fit, and floored at 1 because 0 is never a real fixture.
  targetId: z.number().int().min(1).max(2_147_483_647),
  label: z.string().trim().max(120).nullish(),
  alerts: alertsSchema.optional(),
  muted: z.boolean().optional(),
});

const unfollowSchema = z.object({ kind, targetId: z.number().int().min(1) });

/** Everything this user follows. Theirs only - the id comes from the token, never the request. */
export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok({ follows: await listFollows(user.id) });
});

/**
 * Follows something, or changes the alerts or mute state of a follow that already exists.
 *
 * One endpoint rather than three, because the client's intent is "this is how I want this follow
 * to be" and making it issue a follow, then an alerts update, then a mute, invites the half-done
 * states that happen when the second request fails.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  const body = await parseBody(req, followSchema);

  const row = await follow(user.id, body.kind, body.targetId, {
    // `body.label`, not `body.label ?? null`. The service distinguishes "no label given, leave
    // it alone" (undefined) from "clear the label" (null), and collapsing the first into the
    // second wiped the label of every follow whenever the app changed an alert - which it does
    // without sending one. Found on the device: toggling goals off emptied "Valencia v Athletic
    // Club" on the server.
    label: body.label,
    alerts: body.alerts,
  });
  if (body.muted !== undefined) {
    return ok({ follow: await setMuted(user.id, body.kind, body.targetId, body.muted) });
  }
  return ok({ follow: row });
});

/** Unfollows. Succeeds whether or not it was followed. */
export const DELETE = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  const body = await parseBody(req, unfollowSchema);
  await unfollow(user.id, body.kind, body.targetId);
  return ok({ unfollowed: true });
});
