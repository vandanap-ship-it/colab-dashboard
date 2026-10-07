"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";

/**
 * Approve / Reject bar on a PENDING register sign-off. Same shape as the
 * Safety Induction reviewer bar: Approve goes straight through, Reject
 * opens a reason box (required).
 */
export default function RegisterSubmissionActions({
  submissionId,
  expectedUpdatedAt,
  backHref,
}: {
  submissionId: string;
  expectedUpdatedAt: string;
  backHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "APPROVED" | "REJECTED") {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/register-submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "REJECTED" ? { rejectionReason: reason.trim() } : {}),
          expectedUpdatedAt,
        }),
      });
      if (res.status === 409) {
        setError("This sign-off changed while you were reading it. Refreshing.");
        setSaving(false);
        startTransition(() => router.refresh());
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't save.");
        setSaving(false);
        return;
      }
      startTransition(() => {
        router.push(backHref);
        router.refresh();
      });
    } catch {
      setError("No connection. Check your signal and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}
      {rejectOpen ? (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <p className="font-serif text-lg font-semibold text-ink">Send back for changes</p>
          <label htmlFor="reject-reason" className="block text-sm font-semibold text-stone-700">
            What needs fixing?
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. FE-09 location is wrong, FE-12 missing from the list"
            className="w-full min-h-20 resize-y rounded-lg border-2 border-dashed border-amber-300 bg-white p-2 text-sm"
            maxLength={2000}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setRejectOpen(false);
                setReason("");
                setError(null);
              }}
              className="rounded-xl bg-stone-200 text-ink text-sm font-semibold py-2.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => decide("REJECTED")}
              disabled={saving || isPending || reason.trim().length < 3}
              className="rounded-xl bg-ink text-white text-sm font-semibold py-2.5 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Reject"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            disabled={saving || isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide("APPROVED")}
            disabled={saving || isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {saving || isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
