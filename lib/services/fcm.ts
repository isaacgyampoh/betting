import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { devicesFor, revokeDevice } from "@/lib/services/devices";

/**
 * Sending a notification to a device, via Firebase Cloud Messaging's HTTP v1 API.
 *
 * v1 rather than the legacy server key: the legacy endpoint is retired, and v1 authenticates with
 * a short-lived OAuth token minted from a service account. That key is a credential with full
 * send rights for the project, so it lives in a Worker secret and never in the repository.
 *
 * Everything degrades rather than throws. A notification that cannot be sent is a notification
 * that does not arrive; it is not a reason for the request that triggered it to fail.
 */

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

/** Cached between invocations: a token is good for an hour and minting one costs a round trip. */
let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  const raw = env().FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch {
    // A malformed credential is a configuration mistake, and silence here would look exactly like
    // "nobody has notifications on".
    logger.error("fcm.bad_service_account", {});
    return null;
  }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Turns the PEM in a service-account key into something WebCrypto will sign with. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Mints an access token by signing a JWT with the service account's key.
 *
 * Done by hand rather than with googleapis: that library does not run on Workers, and this is one
 * signed assertion and one POST.
 */
async function accessToken(account: ServiceAccount): Promise<string | null> {
  // A minute of margin, so a token cannot expire between being chosen and being used.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const key = await importKey(account.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    logger.error("fcm.token_failed", { status: response.status });
    return null;
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export type PushMessage = {
  title: string;
  body: string;
  /**
   * Where tapping it should land, as an in-app route: /home/match/42, /home/team/42. Delivered as
   * data rather than inside the notification, because the app reads it on tap.
   */
  route?: string;
  /**
   * Collapses repeats. Two sends with the same key replace each other on the device rather than
   * stacking - which is what stops a goal confirmed twice showing twice.
   */
  collapseKey?: string;
};

export type SendResult = { sent: number; failed: number; revoked: number };

/** True when the project is configured to send at all. */
export function canSendPush(): boolean {
  return serviceAccount() !== null;
}

/**
 * Sends to every live device a user has registered.
 *
 * A token Firebase reports as UNREGISTERED is revoked rather than retried: that means the app was
 * uninstalled or the token rotated, and nothing will ever be delivered to it again.
 */
export async function sendToUser(userId: string, message: PushMessage): Promise<SendResult> {
  const account = serviceAccount();
  if (!account) return { sent: 0, failed: 0, revoked: 0 };

  const tokens = await devicesFor(userId);
  if (!tokens.length) return { sent: 0, failed: 0, revoked: 0 };

  const token = await accessToken(account);
  if (!token) return { sent: 0, failed: tokens.length, revoked: 0 };

  let sent = 0;
  let failed = 0;
  let revoked = 0;

  for (const device of tokens) {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: device,
            notification: { title: message.title, body: message.body },
            // The route travels as data so the app can act on a tap. Strings only: FCM rejects
            // anything else in a data payload.
            data: message.route ? { route: message.route } : undefined,
            android: {
              priority: "HIGH",
              collapseKey: message.collapseKey,
              notification: {
                // Must match PushService._channelId and the manifest's default. A channel's
                // sound is fixed when it is first created, so the id carries a version: naming
                // the old one here would play the system default no matter what the app declares.
                channelId: "gameclaw_matches_v2",
                // res/raw/gameclaw_alert.wav, by resource name without the extension. Android
                // uses the channel's sound on 8.0+; this covers anything older and keeps the
                // two from disagreeing.
                sound: "gameclaw_alert",
                defaultVibrateTimings: true,
              },
            },
            /**
             * iOS takes none of the above.
             *
             * Everything in `android` is ignored on an iPhone, so without this block a
             * backgrounded notification arrives with the system default sound while the same
             * alert in the foreground plays ours - the app would sound different depending on
             * whether it happened to be open, which reads as a bug rather than a setting.
             *
             * The file is `ios/Runner/gameclaw_alert.caf`, bundled as a resource of the Runner
             * target. APNs names it with its extension, unlike Android's resource name, and a
             * name that is not in the bundle plays silence rather than the default.
             *
             * `apns-collapse-id` is the APNs equivalent of Android's collapseKey: a goal
             * confirmed twice replaces its own notification instead of stacking.
             */
            apns: {
              headers: message.collapseKey ? { "apns-collapse-id": message.collapseKey } : undefined,
              payload: { aps: { sound: "gameclaw_alert.caf" } },
            },
          },
        }),
      },
    );

    if (response.ok) {
      sent++;
      continue;
    }

    const text = await response.text();
    // 404 UNREGISTERED and 400 on a malformed token both mean this device is gone for good.
    if (response.status === 404 || text.includes("UNREGISTERED") || text.includes("InvalidRegistration")) {
      await revokeDevice(device);
      revoked++;
    } else {
      failed++;
      logger.warn("fcm.send_failed", { status: response.status });
    }
  }

  return { sent, failed, revoked };
}
