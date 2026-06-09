"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, Loader2, RotateCw, Trash2, X } from "lucide-react";
import { useToast } from "./Toast";
import type { QueuedMutation } from "@/lib/offlineQueue";

/**
 * Bottom-sheet detail view for the offline-write queue.
 *
 * Pre this component, PendingSyncBadge showed a count and tapping it ran
 * retryAll() blind — the engineer had no idea what was queued, why it was
 * stuck, or how to drop a permanently-parked entry. With four mobile forms
 * all queuing through the same store, "5 pending" could mean five healthy
 * progress entries OR a poisoned-pill validation failure that will never
 * succeed.
 *
 * Now: tap the badge → opens this sheet → per-item label, age, attempts,
 * last error (if any) → per-item Discard, footer Retry All.
 */

type RelativeAge = string; // human-readable, e.g. "5m ago" or "just now"

function ageLabel(then: number, now: number): RelativeAge {
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PendingSyncSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<QueuedMutation[] | null>(null);
  // `now` is captured once per refresh so the "5m ago" labels are stable
  // across re-renders (React's purity rule disallows Date.now() during render).
  const [now, setNow] = useState<number>(() => 0);
  const [retryAllPending, setRetryAllPending] = useState(false);
  const [discarding, setDiscarding] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { list } = await import("@/lib/offlineQueue");
      const rows = await list();
      if (cancelled) return;
      setItems(rows);
      setNow(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Refresh + close handlers. We re-list after each mutation so the sheet
  // always reflects what's actually in the queue. useCallback to satisfy
  // the React-purity lint, which can't see that this is only called from
  // event handlers (not during render).
  const refresh = useCallback(async () => {
    const { list } = await import("@/lib/offlineQueue");
    setItems(await list());
    setNow(Date.now());
  }, []);

  async function handleRetryAll() {
    setRetryAllPending(true);
    try {
      const { retryAll } = await import("@/lib/offlineQueue");
      await retryAll();
      await refresh();
      toast.success("Retry attempted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetryAllPending(false);
    }
  }

  async function handleDiscard(id: number) {
    setDiscarding((s) => new Set(s).add(id));
    try {
      const { discard } = await import("@/lib/offlineQueue");
      await discard(id);
      await refresh();
      toast.success("Removed from queue.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not discard");
    } finally {
      setDiscarding((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  if (!open) return null;

  const empty = items !== null && items.length === 0;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close pending sync detail"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-sync-title"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white shadow-2xl max-h-[80vh] flex flex-col"
      >
        {/* Handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-stone-300" aria-hidden />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 flex items-center justify-between">
          <h2
            id="pending-sync-title"
            className="text-base font-semibold text-stone-900 flex items-center gap-2"
          >
            <CloudOff className="w-4 h-4 text-amber-600" />
            Pending sync
            {items && items.length > 0 && (
              <span className="text-sm font-normal text-stone-500">({items.length})</span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 min-h-11 min-w-11 flex items-center justify-center -mr-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 pb-4">
          {items === null && <p className="text-sm text-stone-500 py-6 text-center">Loading…</p>}

          {empty && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-stone-700">No pending entries.</p>
              <p className="text-xs text-stone-500 mt-1">
                Everything you&apos;ve saved has reached the server.
              </p>
            </div>
          )}

          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it, idx) => {
                const isDiscarding = it.id != null && discarding.has(it.id);
                const hasError = !!it.lastError;
                // IndexedDB rows always have an id; the index fallback is
                // for the theoretical pre-insert window only.
                return (
                  <li
                    key={it.id ?? `pending-${idx}`}
                    className={`rounded-lg border p-3 ${
                      hasError ? "border-red-200 bg-red-50/30" : "border-stone-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">{it.label}</p>
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          {ageLabel(it.createdAt, now)}
                          {it.attempts > 0 && (
                            <span>
                              {" · "}
                              {it.attempts} {it.attempts === 1 ? "retry" : "retries"}
                            </span>
                          )}
                        </p>
                        {hasError && (
                          <p className="text-[11px] text-red-700 mt-1.5 break-words">
                            {it.lastError}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => it.id != null && handleDiscard(it.id)}
                        disabled={isDiscarding || it.id == null}
                        className="text-stone-400 hover:text-red-600 disabled:opacity-40 min-h-11 min-w-11 flex items-center justify-center -m-1"
                        aria-label={`Discard ${it.label}`}
                      >
                        {isDiscarding ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items && items.length > 0 && (
          <div className="border-t border-stone-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] bg-white">
            <button
              type="button"
              onClick={handleRetryAll}
              disabled={retryAllPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-60"
            >
              {retryAllPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
              {retryAllPending ? "Retrying…" : "Retry all"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
