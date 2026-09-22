"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, RotateCcw, Loader2 } from "lucide-react";

type ExpenseStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

/**
 * Sticky action bar on the mobile Expense detail. Bar adapts by role and
 * status. All rules also live server-side in /api/expenses/[id] PATCH —
 * this component is UX shaping only.
 *
 *   Approver + SUBMITTED → Reject | Approve
 *   Approver + REJECTED  → (no action — logger's turn to fix)
 *   Logger + REJECTED    → Resubmit
 *   Everyone else / terminal → parent hides the bar
 */
export default function MobileExpenseActions({
  expenseId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
  iCanApprove,
  iAmLogger,
}: {
  expenseId: string;
  currentStatus: ExpenseStatus;
  expectedUpdatedAt: string;
  projectId: string;
  iCanApprove: boolean;
  iAmLogger: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(
    status: "SUBMITTED" | "APPROVED" | "REJECTED",
    rejectionReason?: string,
  ) {
    setError(null);
    const res = await fetch(`/api/expenses/${expenseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
        expectedUpdatedAt,
      }),
    });
    if (res.status === 409) {
      setError("Someone updated this expense while you were reading. Refreshing.");
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
    const backTab =
      status === "APPROVED" ? "approved" : status === "REJECTED" ? "rejected" : "submitted";
    startTransition(() => {
      router.push(`/mobile/${projectId}/expense?tab=${backTab}`);
      router.refresh();
    });
  }

  const canApprovePair = iCanApprove && currentStatus === "SUBMITTED";
  const canResubmit = iAmLogger && currentStatus === "REJECTED";

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}

      {canApprovePair && (
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
            onClick={() => patch("APPROVED")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approve
          </button>
        </div>
      )}

      {canResubmit && (
        <button
          type="button"
          onClick={() => patch("SUBMITTED")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          Resubmit for approval
        </button>
      )}

      {rejectOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wide">
            Why reject?
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's off — the logger needs to fix this before resubmitting."
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
              {isPending ? "Saving…" : "Reject expense"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
