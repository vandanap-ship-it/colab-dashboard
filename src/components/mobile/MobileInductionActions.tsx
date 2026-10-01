"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, Loader2 } from "lucide-react";

/**
 * Bottom-sticky Approve / Reject bar on the mobile Safety Induction
 * detail. Only renders when the current user is a reviewer AND the
 * induction is still PENDING; everything else gets a non-interactive
 * state line one level up.
 *
 * Mirrors the structure of MobileQaqcReviewActions — Reject opens a
 * remark sheet (reason required), Approve goes through immediately
 * with no confirm sheet (fast path — reviewer tapped the row to
 * approve a worker, they shouldn't have to tap again). The reason is
 * the single-approver flow Shraddha set 2026-10-01: Girish knows the
 * worker, has the Aadhaar + signature in hand on the detail page,
 * doesn't need a confirmation dialog to say yes.
 */
export default function MobileInductionActions({
  inductionId,
  projectId,
  expectedUpdatedAt,
}: {
  inductionId: string;
  projectId: string;
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(status: "APPROVED" | "REJECTED", rejectionReason?: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/safety-inductions/${inductionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
        expectedUpdatedAt,
      }),
    });
    if (res.status === 409) {
      setError("Someone updated this induction while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      setSaving(false);
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    setRejectOpen(false);
    setReason("");
    // Back to the Submitted To Me queue — the reviewer's inbox for this
    // flow. Keeps the deciding-rhythm tight.
    startTransition(() => {
      router.push(`/mobile/${projectId}/induction?tab=assigned`);
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
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setRejectOpen(true)}
          disabled={isPending || saving}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
        <button
          type="button"
          onClick={() => patch("APPROVED")}
          disabled={isPending || saving}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Approve
        </button>
      </div>

      {rejectOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <p className="font-serif text-lg font-semibold text-ink">Reject Induction</p>
          <label className="block text-sm font-semibold text-stone-700">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's missing — Aadhaar unclear, PPE training not done, etc."
            className="w-full min-h-20 resize-y rounded-lg border-2 border-dashed border-amber-300 bg-white p-2 text-sm"
            maxLength={1000}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setReason(""); setError(null); }}
              className="rounded-xl bg-ink text-white text-sm font-semibold py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => patch("REJECTED", reason.trim() || undefined)}
              disabled={isPending || saving || reason.trim().length < 3}
              className="rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Ok"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
