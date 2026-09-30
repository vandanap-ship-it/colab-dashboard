"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, Lock, Loader2, PauseCircle, PlayCircle } from "lucide-react";
import type { WorkPermitStatus } from "@/lib/workPermit";

/**
 * Sticky action bar on the mobile Work Permit detail. Buttons shown depend
 * on the caller's relationship to the permit AND the current status. The
 * server PATCH re-enforces every rule; this component just decides which
 * affordances to render.
 *
 *   PENDING + iAmApprover              → Approve | Reject
 *   APPROVED + iAmApprover              → Suspend | Close (+ Reject fallback)
 *   APPROVED + iAmRequester             → Close
 *   SUSPENDED + iAmApprover             → Resume | Close
 *   REJECTED / CLOSED                   → no bar
 *
 * Reject opens an inline sheet asking for the reason — the API rejects a
 * reject without a reason so the requester knows what to fix.
 * Suspend opens an equivalent sheet with an optional "Suspend Remark"
 * (Colab semantics — the field exists but is not required).
 */
export default function MobilePermitActions({
  permitId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
  iAmApprover,
  iAmRequester,
  iCanSuspend = false,
}: {
  permitId: string;
  currentStatus: WorkPermitStatus;
  expectedUpdatedAt: string;
  projectId: string;
  iAmApprover: boolean;
  iAmRequester: boolean;
  // Colab-parity: only an approver whose PermitApprover row has
  // canSuspend=true sees the Suspend button. Defaults to false so
  // callers that haven't wired the check yet don't accidentally show it.
  iCanSuspend?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(
    status: "APPROVED" | "REJECTED" | "CLOSED" | "SUSPENDED",
    opts?: { rejectionReason?: string; suspensionReason?: string },
  ) {
    setError(null);
    const res = await fetch(`/api/work-permits/${permitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(opts?.rejectionReason ? { rejectionReason: opts.rejectionReason } : {}),
        ...(opts?.suspensionReason ? { suspensionReason: opts.suspensionReason } : {}),
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
    setSuspendOpen(false);
    setReason("");
    setSuspendReason("");
    // Resume + suspend stay on the detail page (user's just looking at
    // what they just did); approve/reject/close return to the list.
    startTransition(() => {
      if (status === "SUSPENDED" || (status === "APPROVED" && currentStatus === "SUSPENDED")) {
        router.refresh();
      } else {
        router.push(`/mobile/${projectId}/permit`);
        router.refresh();
      }
    });
  }

  const canReject =
    iAmApprover &&
    (currentStatus === "PENDING" || currentStatus === "APPROVED" || currentStatus === "SUSPENDED");
  const canApprove = iAmApprover && currentStatus === "PENDING";
  const canClose =
    (currentStatus === "APPROVED" || currentStatus === "SUSPENDED") &&
    (iAmApprover || iAmRequester);
  const canSuspend = iCanSuspend && currentStatus === "APPROVED";
  const canResume = iAmApprover && currentStatus === "SUSPENDED";

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

      {!canApprove && (canClose || canSuspend || canResume) && (
        <div className="grid grid-cols-2 gap-2">
          {canResume && (
            <button
              type="button"
              onClick={() => patch("APPROVED")}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold py-3 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              Resume
            </button>
          )}
          {canSuspend && (
            <button
              type="button"
              onClick={() => setSuspendOpen(true)}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold py-3 disabled:opacity-60"
            >
              <PauseCircle className="w-4 h-4" />
              Suspend
            </button>
          )}
          {canReject && !canSuspend && !canResume && (
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
          {canClose && (
            <button
              type="button"
              onClick={() => patch("CLOSED")}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Close permit
            </button>
          )}
        </div>
      )}
      {/* Reject as a secondary link when Suspend / Resume dominates the
          primary grid. Keeps the destructive action available on
          APPROVED and SUSPENDED permits without stealing focus from the
          more common Close / Resume flows. */}
      {!canApprove && canReject && (canSuspend || canResume) && (
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
            className="text-[12px] font-semibold text-red-700 underline disabled:opacity-40"
          >
            Reject permit instead
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
              onClick={() => patch("REJECTED", { rejectionReason: reason.trim() || undefined })}
              disabled={isPending || reason.trim().length < 3}
              className="rounded-xl bg-red-600 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Reject permit"}
            </button>
          </div>
        </div>
      )}

      {suspendOpen && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wide">
            Suspend remark (optional)
          </label>
          <textarea
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Why pause the work — e.g. rain, missing PPE, adjacent activity."
            className="w-full min-h-16 resize-y rounded-lg border border-amber-200 bg-white p-2 text-sm"
            maxLength={1000}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setSuspendOpen(false); setSuspendReason(""); setError(null); }}
              className="rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => patch("SUSPENDED", { suspensionReason: suspendReason.trim() || undefined })}
              disabled={isPending}
              className="rounded-xl bg-amber-500 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Suspend"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
