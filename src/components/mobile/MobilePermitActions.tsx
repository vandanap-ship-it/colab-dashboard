"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, Lock, Loader2 } from "lucide-react";
import type { WorkPermitStatus } from "@/lib/workPermit";

/**
 * Sticky action bar on the mobile Work Permit detail. Buttons shown depend
 * on the caller's relationship to the permit AND the current status. The
 * server PATCH re-enforces every rule; this component just decides which
 * affordances to render.
 *
 *   PENDING + iAmApprover           → Approve | Reject (both in one row)
 *   APPROVED + (approver | requester) → Close
 *   APPROVED + iAmApprover           → also Reject (setup turned out unsafe)
 *   REJECTED / CLOSED                 → no bar
 *
 * Reject opens an inline sheet asking for the reason — the API rejects a
 * reject without a reason so the requester knows what to fix.
 */
export default function MobilePermitActions({
  permitId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
  iAmApprover,
  iAmRequester,
}: {
  permitId: string;
  currentStatus: WorkPermitStatus;
  expectedUpdatedAt: string;
  projectId: string;
  iAmApprover: boolean;
  iAmRequester: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(status: "APPROVED" | "REJECTED" | "CLOSED", rejectionReason?: string) {
    setError(null);
    const res = await fetch(`/api/work-permits/${permitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
        expectedUpdatedAt,
      }),
    });
    if (res.status === 409) {
      setError("Someone updated this permit while you were reading. Refreshing.");
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
    startTransition(() => {
      router.push(`/mobile/${projectId}/permit`);
      router.refresh();
    });
  }

  const canReject =
    (iAmApprover && (currentStatus === "PENDING" || currentStatus === "APPROVED"));
  const canApprove = iAmApprover && currentStatus === "PENDING";
  const canClose =
    currentStatus === "APPROVED" && (iAmApprover || iAmRequester);

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}

      {canApprove && (
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

      {!canApprove && canClose && (
        <div className={canReject ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>
          {canReject && (
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
            >
              <X className="w-4 h-4" />
              Reject
            </button>
          )}
          <button
            type="button"
            onClick={() => patch("CLOSED")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Close permit
          </button>
        </div>
      )}

      {rejectOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wide">
            Why reject?
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's unsafe or missing — the requester needs to fix this before re-raising."
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
              {isPending ? "Saving…" : "Reject permit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
