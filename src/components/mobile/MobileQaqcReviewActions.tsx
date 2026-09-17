"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, Loader2 } from "lucide-react";

/**
 * Bottom-sticky Pass / Reject bar on the mobile inspection detail page.
 *
 * PATCH /api/inspections/[id] does the work; the button flow just needs to:
 *   - Confirm Pass (one tap → confirm → PATCH status=PASSED)
 *   - Open a "why?" sheet for Reject (reason required, sends status=REJECTED)
 *   - Refresh the router so the detail page re-fetches with the new status
 *
 * We deliberately don't fetch full inspection data client-side after the
 * update — the server component that renders the page picks up the refresh
 * and the reviewer sees the consolidated new state.
 */
export default function MobileQaqcReviewActions({
  inspectionId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
}: {
  inspectionId: string;
  currentStatus: "IN_REVIEW" | "PASSED" | "REJECTED";
  expectedUpdatedAt: string; // ISO of Inspection.updatedAt for the 409 guard
  projectId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(status: "PASSED" | "REJECTED", rejectionReason?: string) {
    setError(null);
    const res = await fetch(`/api/inspections/${inspectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
        expectedUpdatedAt,
      }),
    });
    if (res.status === 409) {
      setError("Someone updated this inspection while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }
    setRejectOpen(false);
    setReason("");
    // Land on the pending list — the natural next thing a reviewer wants.
    startTransition(() => {
      router.push(`/mobile/${projectId}/qaqc?tab=pending`);
      router.refresh();
    });
  }

  // Already reviewed → don't offer buttons. Keep a subtle hint so the reviewer
  // knows why they can't act again from here.
  if (currentStatus !== "IN_REVIEW") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center text-xs text-stone-500">
        This inspection has already been {currentStatus === "PASSED" ? "passed" : "rejected"}.
        Reopen it from the desktop QA/QC list if it needs another look.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setRejectOpen(true)}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
        <button
          type="button"
          onClick={() => patch("PASSED")}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Pass
        </button>
      </div>

      {/* Reject-reason sheet — inline so it slides into place rather than as a
          modal. Reason is required so the filler knows what to fix. */}
      {rejectOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wide">
            Why reject?
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What needs to be fixed before we can pass this?"
            className="w-full min-h-20 resize-y rounded-lg border border-stone-300 bg-white p-2 text-sm"
            maxLength={1000}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setReason(""); setError(null); }}
              className="rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => patch("REJECTED", reason.trim() || undefined)}
              disabled={isPending || reason.trim().length < 3}
              className="rounded-xl bg-red-600 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Reject inspection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
