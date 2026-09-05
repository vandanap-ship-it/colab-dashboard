"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import PendingSyncSheet from "./PendingSyncSheet";

/**
 * Small badge that appears on mobile screens when there are entries waiting
 * to sync. Tapping it now opens a detail bottom-sheet (PendingSyncSheet)
 * instead of running retryAll() blind — engineers can see which entries are
 * queued, how long they've waited, what error each saw, and discard
 * permanently-poisoned items individually. "Retry all" still lives one tap
 * away in the sheet's footer.
 *
 * Hides itself when the queue is empty.
 */
export default function PendingSyncBadge() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

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

  // Warn the engineer if they try to close / navigate away with pending
  // entries. IndexedDB does survive a browser reopen, but "clear site
  // data" or switching to a different browser loses them silently. The
  // native browser confirmation dialog is enough to catch the
  // "accidentally closed the tab" case. Modern browsers ignore custom
  // messages (Chromium 51+, Firefox 44+) but the default prompt still
  // fires whenever preventDefault is called.
  useEffect(() => {
    if (count === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy prop for Safari / older browsers that still read it.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [count]);

  if (count === 0 && !open) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 border border-amber-300 hover:bg-amber-200"
      >
        <CloudOff className="w-3.5 h-3.5" />
        {count} pending sync · tap to view
      </button>
      <PendingSyncSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
