"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Zero-render helper that keeps the bell badge honest when the user
 * tabs away and back.
 *
 * The unread count is computed SSR in the mobile layout, so once the
 * page is rendered the badge is a static number. If a WIR gets
 * assigned while the tab is in the background, or the engineer opens
 * the inbox on another device and marks everything read, the badge
 * still shows what the layout captured at initial load.
 *
 * router.refresh() re-runs the server components in the current tree,
 * which is exactly what we want — the layout's parallel Promise.all
 * re-queries getUnreadNotificationCount and MobileBottomNav renders
 * with the new value.
 *
 * Debounced with a 15s minimum interval so rapid tab-switching (say,
 * clicking through Slack / email in another window) doesn't fire a
 * refresh every second. Mounted inside the mobile layout so it lives
 * as long as the engineer is inside the app.
 */
const MIN_REFRESH_INTERVAL_MS = 15_000;

export default function BellAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    function maybeRefresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_REFRESH_INTERVAL_MS) return;
      last = now;
      router.refresh();
    }
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [router]);
  return null;
}
