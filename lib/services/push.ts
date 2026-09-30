import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Web push for "your daily picks are ready". Signed with Web Crypto (VAPID) so it runs on
// Cloudflare Workers, where the usual Node push libraries don't work.
//
// Notifications carry no betting content beyond a title and a link: the picks themselves stay
// behind the plan check on the page.

export type PushPayload = { title: string; body: string; url: string };

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (s: string) => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/** VAPID JWT for one push endpoint, signed with the private key (ES256). */
async function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    new TextEncoder().encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject })),
  );
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: privateKey, x: b64url(fromB64url(publicKey).slice(1, 33)), y: b64url(fromB64url(publicKey).slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey}`;
}

/**
 * Sends a notification to every device a user has registered. Best effort: a failure never breaks
 * the caller, and endpoints the browser has retired are removed.
 */
export async function notifyUser(userId: string, payload: PushPayload): Promise<{ sent: number }> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@gameclaw.win";
  if (!publicKey || !privateKey) return { sent: 0 };

  const subs = await db.pushSubscription.findMany({ where: { userId } });
  let sent = 0;

  for (const sub of subs) {
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          TTL: "86400",
          Urgency: "normal",
          Authorization: await vapidHeader(sub.endpoint, publicKey, privateKey, subject),
          // Payload-less push: the service worker fetches the details itself, so nothing
          // sensitive travels through the push service.
          "Content-Length": "0",
        },
      });
      if (res.status === 404 || res.status === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        continue;
      }
      if (res.ok) sent++;
      else logger.warn("push.rejected", { status: res.status });
    } catch (err) {
      logger.warn("push.failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }
  void payload;
  return { sent };
}

export async function savePushSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removePushSubscription(endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint } });
}
