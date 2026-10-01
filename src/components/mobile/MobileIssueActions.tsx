"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Send, Loader2, XCircle } from "lucide-react";

/**
 * Sticky action bar on the mobile snag detail. Renders different affordances
 * depending on who's looking (Colab 2026-10-01 parity: 4-state state machine
 * New → In Review → Closed / Rejected, with Rejected → In Review loopback):
 *
 *   - REVIEWER + status OPEN               → "Mark resolved" (skips reinspection)
 *   - REVIEWER + status IN_REINSPECTION    → "Reject" | "Reopen" | "Mark resolved"
 *   - ASSIGNEE + status OPEN               → "Ready for re-inspection"
 *   - ASSIGNEE + status REJECTED           → "Ready for re-inspection" (re-loop
 *                                            after a reviewer bounce)
 *   - Anyone else                          → parent hides the bar entirely
 *
 * The API PATCH does the security work; this bar just steers the UX to the
 * right transition and reflects the current row with the optimistic-lock
 * ISO so a stale phone tab gets a clean 409 instead of stomping.
 */
export default function MobileIssueActions({
  issueId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
  iCanReview,
  iAmAssignee,
}: {
  issueId: string;
  currentStatus: "OPEN" | "IN_REINSPECTION" | "RESOLVED" | "REJECTED";
  expectedUpdatedAt: string;
  projectId: string;
  iCanReview: boolean;
  iAmAssignee: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(status: "OPEN" | "IN_REINSPECTION" | "RESOLVED" | "REJECTED") {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      setError("Someone updated this snag while you were reading. Refreshing.");
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
    // Back to the tab that matches the NEW status — Colab-parity 4-tab
    // list (New / In Review / Closed / Rejected). Mapping: OPEN → new,
    // IN_REINSPECTION → in-review, RESOLVED → closed, REJECTED → rejected.
    const tab =
      status === "RESOLVED"
        ? "closed"
        : status === "IN_REINSPECTION"
          ? "in-review"
          : status === "REJECTED"
            ? "rejected"
            : "new";
    startTransition(() => {
      router.push(`/mobile/${projectId}/issue?tab=${tab}`);
      router.refresh();
    });
  }

  // Assignee (contractor) can signal "please re-check" from OPEN or from
  // REJECTED (reviewer bounced a prior fix). Everything else for a non-
  // reviewer has no action.
  const showAssigneeReinspect =
    iAmAssignee &&
    !iCanReview &&
    (currentStatus === "OPEN" || currentStatus === "REJECTED");

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}

      {/* Reviewer bar — differs by current status. Resolve is always the
          primary (right) button because resolving is the terminal "done"
          action; the secondary action changes with context. */}
      {iCanReview && currentStatus === "OPEN" && (
        <button
          type="button"
          onClick={() => patch("RESOLVED")}
          disabled={isPending || saving}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Close
        </button>
      )}

      {iCanReview && currentStatus === "IN_REINSPECTION" && (
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => patch("REJECTED")}
            disabled={isPending || saving}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <XCircle className="w-4 h-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => patch("OPEN")}
            disabled={isPending || saving}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Reopen
          </button>
          <button
            type="button"
            onClick={() => patch("RESOLVED")}
            disabled={isPending || saving}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Close
          </button>
        </div>
      )}

      {/* Reviewer looking at a REJECTED snag can still reopen it to NEW
          or close it directly (sometimes a reject gets overturned after
          chat). Keeps the review loop short. */}
      {iCanReview && currentStatus === "REJECTED" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch("OPEN")}
            disabled={isPending || saving}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Reopen
          </button>
          <button
            type="button"
            onClick={() => patch("RESOLVED")}
            disabled={isPending || saving}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Close
          </button>
        </div>
      )}

      {/* Assignee (non-reviewer) — the only action they get is "please
          re-check" once they've fixed the defect. Different label + icon
          from the reviewer's own Reopen so the hand-off reads correctly. */}
      {showAssigneeReinspect && (
        <button
          type="button"
          onClick={() => patch("IN_REINSPECTION")}
          disabled={isPending || saving}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ready for re-inspection
        </button>
      )}
    </div>
  );
}
