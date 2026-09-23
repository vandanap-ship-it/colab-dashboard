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
 * Fan out a push payload to every subscription the user has, AND write
 * the same payload to the persistent Notification inbox so the mobile
 * bell has an accurate unread count + scrollable history even when the
 * push itself never lands (VAPID unconfigured, phone off, tab closed,
 * or the browser hostile to service workers). No-op on the browser-push
 * side when VAPID isn't configured; the inbox insert still fires so
 * dev / preview envs get a realistic bell to look at. Silently prunes
 * dead subscriptions (404 / 410).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  // Inbox write first — separately try/catch'd so a failed insert never
  // blocks the browser push (or vice versa). Best-effort by design; the
  // push itself is the source of truth for "did the user get notified".
  // Capture the inserted row's id so the browser-push payload can carry
  // it downstream — the service worker uses it to mark the inbox row
  // read the moment the user taps the notification.
  //
  // Tag dedup: when payload.tag is set, remove any prior inbox row for
  // this (userId, tag) before inserting. Matches the browser-side
  // Notification API's tag semantics — a re-send of the same permit
  // approval / waiting nudge / etc. replaces the earlier one rather
  // than stacking a second unread badge for the same event.
  let notificationId: string | undefined;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (payload.tag) {
        await tx.notification.deleteMany({ where: { userId, tag: payload.tag } });
      }
      return tx.notification.create({
        data: {
          userId,
          title: payload.title,
          body: payload.body,
          url: payload.url ?? null,
          tag: payload.tag ?? null,
        },
        select: { id: true },
      });
    });
    notificationId = row.id;
  } catch (err) {
    console.warn("[push] inbox insert failed", { userId, title: payload.title, msg: (err as Error).message });
  }

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
  // Carry the inbox row's id in the browser-push payload as
  // `notificationId` so the service worker can PATCH it read on tap. Not
  // set if the inbox insert failed above — the SW handles that as "no
  // read call, just open the URL" so the tap still works.
  const wirePayload = notificationId ? { ...payload, notificationId } : payload;
  const payloadStr = JSON.stringify(wirePayload);

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
