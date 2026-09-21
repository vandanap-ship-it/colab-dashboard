"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, RotateCcw, Loader2 } from "lucide-react";

type ConcernStatus = "PENDING" | "READ" | "TASK_ASSIGNED" | "RESOLVED";

/**
 * Sticky action bar on the mobile Concern detail. Concerns have a slightly
 * odd shape — anyone signed in can mark a PENDING concern as READ, but only
 * a reviewer can resolve or re-open. Bar adapts:
 *
 *   - PENDING + not reviewer → "Mark as read" (single soft button)
 *   - PENDING/READ + reviewer → "Mark as read" (only when still pending) +
 *                               "Mark resolved" primary
 *   - TASK_ASSIGNED + reviewer → "Mark resolved" (assignment already
 *                                delegated it; resolve closes the loop)
 *   - RESOLVED + reviewer → "Reopen"
 *   - Anyone else → parent hides the bar
 */
export default function MobileConcernActions({
  concernId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
  iCanReview,
}: {
  concernId: string;
  currentStatus: ConcernStatus;
  expectedUpdatedAt: string;
  projectId: string;
  iCanReview: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(status: ConcernStatus, backTab: "pending" | "read" | "task_assigned" | "resolved") {
    setError(null);
    const res = await fetch(`/api/concerns/${concernId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      setError("Someone updated this concern while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }
    startTransition(() => {
      router.push(`/mobile/${projectId}/concern?tab=${backTab}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}

      {/* Non-reviewer, PENDING — only affordance is "acknowledge". Everyone
          else in this state sees no bar (parent handles that). */}
      {!iCanReview && currentStatus === "PENDING" && (
        <button
          type="button"
          onClick={() => patch("READ", "read")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Mark as read
        </button>
      )}

      {iCanReview && currentStatus === "PENDING" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch("READ", "read")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <Eye className="w-4 h-4" />
            Mark read
          </button>
          <button
            type="button"
            onClick={() => patch("RESOLVED", "resolved")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Resolve
          </button>
        </div>
      )}

      {iCanReview && (currentStatus === "READ" || currentStatus === "TASK_ASSIGNED") && (
        <button
          type="button"
          onClick={() => patch("RESOLVED", "resolved")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Mark resolved
        </button>
      )}

      {iCanReview && currentStatus === "RESOLVED" && (
        <button
          type="button"
          onClick={() => patch("PENDING", "pending")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
        >
          <RotateCcw className="w-4 h-4" />
          Reopen
        </button>
      )}
    </div>
  );
}
