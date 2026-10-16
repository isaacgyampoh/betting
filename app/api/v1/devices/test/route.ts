import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { canSendPush, sendToUser } from "@/lib/services/fcm";

/**
 * Sends a notification to the caller's own devices, and nobody else's.
 *
 * A real feature rather than a debugging hook: "why am I not getting alerts?" is the most common
 * question any app with notifications gets, and the only honest answer is to try one and see. It
 * reports what actually happened - how many devices it reached, how many were dead - rather than
 * a cheerful "sent!" that means nothing.
 *
 * Deliberately limited to the caller. There is no user id in the body, so this cannot be used to
 * send anything to anyone else.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));

  if (!canSendPush()) {
    throw new AppError(
      "STATS_UNAVAILABLE",
      "Notifications aren't configured on the server yet, so nothing can be sent.",
    );
  }

  const result = await sendToUser(user.id, {
    title: "GameClaw",
    body: "Notifications are working on this device.",
    // Lands on the live centre. Proves the tap path end to end, and is somewhere worth being.
    route: "/home",
    collapseKey: "gameclaw-test",
  });

  if (result.sent === 0 && result.revoked > 0) {
    throw new AppError(
      "BAD_REQUEST",
      "This device's registration has expired. Turn alerts off and on again.",
    );
  }
  if (result.sent === 0) {
    throw new AppError("BAD_REQUEST", "No device is registered for notifications on this account.");
  }

  return ok(result);
});
