/**
 * Siddhi service worker.
 *
 * Registered from the mobile layout when a user has opted in to push
 * notifications. Kept intentionally minimal — this worker's only job is
 * to receive push events and open the right URL when the user taps the
 * resulting notification.
 *
 * Not doing offline caching here. Site engineers already have the
 * IndexedDB offline queue for their own mutations; caching pages ahead
 * of time would add whole-app-refresh complexity for a launch that
 * doesn't need it. If we add offline browsing later this worker gets
 * a fetch handler.
 *
 * Versioning: bump SW_VERSION whenever the handler logic changes; the
 * browser then treats the new worker as different bytes and reinstalls
 * on next page load.
 */

const SW_VERSION = "siddhi-sw-v1";

self.addEventListener("install", (event) => {
  // Skip the "wait for old worker" step so a fresh version activates
  // immediately on the next page load rather than after every tab is
  // closed. Safe because we're not caching anything worth preserving.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Fallback for text-only pushes (shouldn't happen from our server).
    payload = { title: "Siddhi", body: event.data.text() };
  }

  const title = payload.title || "Siddhi";
  const options = {
    body: payload.body || "",
    // App-branded icon rendered next to the notification text.
    icon: "/icon",
    // Small monochrome badge shown in the status bar on Android.
    badge: "/icon",
    // Tag collapses same-topic notifications so a re-decision on the
    // same permit shows one entry, not a stack.
    tag: payload.tag,
    // Extra vibration signals a real-world event — the site engineer
    // wants to know their permit was approved even if the phone was
    // face-down.
    vibrate: [100, 50, 100],
    // Stash the target URL for notificationclick to read.
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If Siddhi is already open in a tab, focus that tab and navigate.
      for (const client of clientsList) {
        try {
          const clientUrl = new URL(client.url);
          const siddhiOrigin = self.registration.scope
            ? new URL(self.registration.scope).origin
            : self.location.origin;
          if (clientUrl.origin === siddhiOrigin && "focus" in client) {
            await client.focus();
            if ("navigate" in client) await client.navigate(url);
            return;
          }
        } catch {
          // Ignore malformed client URLs.
        }
      }
      // No Siddhi tab open → open a fresh one at the target URL.
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

// Some browsers rotate the push subscription silently. Cheap-fallback:
// tell the app to re-subscribe. Full round-trip lives in the client-side
// opt-in code — we can't POST from here reliably without an active
// session cookie.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((cs) => {
      cs.forEach((c) => c.postMessage({ type: "resubscribe" }));
    }),
  );
});
