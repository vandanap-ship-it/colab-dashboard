import "server-only";

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Web Push notifications from server → user's device.
 *
 * Setup requires two VAPID keys in Vercel env:
 *   VAPID_PUBLIC_KEY   — safe in client bundle, given to the
 *                                    browser at subscribe time.
 *   VAPID_PRIVATE_KEY              — server only, signs each push request.
 *
 * The public key is also exposed to the mobile opt-in code via a small API
 * endpoint (/api/push/vapid-public) so the service worker can subscribe
 * without inlining the key at build time.
 *
 * All errors are swallowed: a failed push is never fatal to the calling
 * event handler (permit approve, concern assign, etc). If a subscription
 * comes back 404 or 410 (user unsubscribed on the browser side) we
 * delete the row so we don't keep pushing to a dead endpoint.
 */

const CONFIGURED = Boolean(
  process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY,
);
if (CONFIGURED) {
  webpush.setVapidDetails(
    // Contact email so push services can reach us if something goes wrong.
    "mailto:product@whitelotusgroup.in",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export interface PushPayload {
  /** Notification title shown in bold on the phone. */
  title: string;
  /** Notification body — one to two lines. */
  body: string;
  /** Absolute or relative URL to open when the notification is tapped. */
  url?: string;
  /** Optional tag so a later notification of the same type replaces
   *  the previous one instead of stacking (e.g. one "permit approved"
   *  entry per permit). */
  tag?: string;
}

/**
 * Fan out a push payload to every subscription the user has. No-op when
 * VAPID isn't configured (dev env or before Vercel env is set). Silently
 * prunes dead subscriptions (404 / 410).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!CONFIGURED) {
    if (process.env.NODE_ENV !== "test") {
      console.info("[push] VAPID keys not configured, skipping send", { userId, title: payload.title });
    }
    return { sent: 0, pruned: 0 };
  }
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  let pruned = 0;
  const payloadStr = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      const sub: WebPushSubscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(sub, payloadStr);
        sent += 1;
        // Best-effort update lastUsedAt so we can prune truly-stale
        // subscriptions later. Failures here don't affect the send.
        await prisma.pushSubscription
          .update({ where: { id: s.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Subscription is dead on the browser side. Remove the row.
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          pruned += 1;
        } else {
          console.warn("[push] send failed", { userId, endpoint: s.endpoint.slice(0, 50), code, msg: (err as Error).message });
        }
      }
    }),
  );

  return { sent, pruned };
}
