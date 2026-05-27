"use client";

import { useEffect, useState } from "react";
import { CloudOff, Loader2 } from "lucide-react";

/**
 * Small badge that appears on mobile screens when there are entries waiting
 * to sync. Sits inline (no fixed positioning) so it doesn't fight with
 * existing layout.
 *
 * Hides itself when count is 0. Tapping it triggers a manual retry.
 */
export default function PendingSyncBadge() {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Dynamic import — IndexedDB is browser-only.
    (async () => {
      const { subscribe, installAutoFlush } = await import("@/lib/offlineQueue");
      installAutoFlush();
      if (cancelled) return;
      unsubscribe = subscribe((n) => setCount(n));
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  async function handleRetry() {
    setBusy(true);
    try {
      const { retryAll } = await import("@/lib/offlineQueue");
      await retryAll();
    } finally {
      setBusy(false);
    }
  }

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={handleRetry}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 border border-amber-300 hover:bg-amber-200 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <CloudOff className="w-3.5 h-3.5" />
      )}
      {count} pending sync · tap to retry
    </button>
  );
}
