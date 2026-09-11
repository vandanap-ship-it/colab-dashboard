"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

/**
 * "Turn on notifications" nudge for mobile users.
 *
 * Complements InstallPrompt (add to home screen) — this one is about
 * push notifications outside the app. Rendered near the top of any
 * authenticated mobile page.
 *
 * State machine:
 *   1. Not shown at all until:
 *      - browser supports Notification API + serviceWorker + PushManager
 *      - permission is "default" (not yet granted or denied)
 *      - not dismissed within the last 30 days on this device
 *   2. User taps "Turn on" → requests browser permission
 *      - Granted → register service worker → subscribe to push manager
 *                  → POST subscription to /api/push/subscribe
 *                  → banner hides forever on this device
 *      - Denied → hide banner; browser will not re-prompt on this
 *                 origin without a manual reset in Chrome settings
 *   3. X dismiss → hide for 30 days
 *
 * All storage / permission API errors are swallowed. A failed opt-in
 * silently doesn't subscribe rather than throwing.
 *
 * iOS note: web push works on iOS 16.4+ but ONLY inside a home-screen-
 * installed PWA (running in standalone mode). This component shows the
 * banner on iOS Safari the same as anywhere else, but the browser will
 * refuse the subscription until Siddhi has been added to the home
 * screen. The InstallPrompt banner handles that flow.
 */

const DISMISS_KEY = "siddhi-push-optin-dismissed-until";
const DISMISS_DAYS = 30;

// Standard base64url → Uint8Array for the VAPID public key. Push manager
// wants raw bytes, but VAPID keys are transported as base64url strings.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribe(): Promise<"ok" | "denied" | "unsupported" | "error"> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  // 1. Fetch the server's VAPID public key.
  const vapidRes = await fetch("/api/push/vapid-public", { credentials: "include" });
  if (!vapidRes.ok) return "error";
  const { publicKey } = await vapidRes.json();

  // 2. Ask browser permission.
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";

  // 3. Register the service worker (idempotent, safe to call every time).
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  // 4. Subscribe to the push manager (or reuse an existing subscription).
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Type stopgap: modern TS lib types want ArrayBuffer<ArrayBufferLike>
      // for applicationServerKey; Uint8Array is what the runtime actually
      // expects. Cast at the boundary rather than changing the helper's
      // signature (`Uint8Array<ArrayBufferLike>` is the intent).
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  }

  // 5. Send the subscription to our server.
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const post = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  });
  if (!post.ok) return "error";
  return "ok";
}

export default function PushOptIn() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Feature-gate.
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    // Recently dismissed?
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) || "0");
      if (until && Date.now() < until) return;
    } catch {
      // ignore
    }
    setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
    } catch {}
  }

  async function turnOn() {
    setBusy(true);
    try {
      const outcome = await subscribe();
      if (outcome === "ok") {
        setVisible(false);
      } else if (outcome === "denied") {
        // Browser will not re-prompt; hide the banner permanently.
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 365 * 86400000)); } catch {}
        setVisible(false);
      } else {
        // Unsupported or error — keep the banner but drop the busy state.
        console.warn("[push-optin] subscribe outcome:", outcome);
      }
    } catch (e) {
      console.warn("[push-optin] subscribe threw:", e);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mx-4 mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
      <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0">
        <Bell className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          Get updates on your phone
        </p>
        <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
          Permit approvals, assigned snags, and today&apos;s progress reminders reach your phone even when Siddhi is closed.
        </p>
        <button
          type="button"
          onClick={turnOn}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white text-xs font-medium px-3 py-1.5 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="p-1 -mr-1 -mt-1 rounded text-amber-700/70 hover:text-amber-900"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
