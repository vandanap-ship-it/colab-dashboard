"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Send, Loader2 } from "lucide-react";

/**
 * Sticky action bar on the mobile snag detail. Renders different affordances
 * depending on who's looking:
 *
 *   - REVIEWER + status OPEN            → "Mark resolved" (skips reinspection)
 *   - REVIEWER + status IN_REINSPECTION → "Mark resolved" | "Reopen"
 *   - ASSIGNEE + status OPEN            → "Ready for re-inspection" (single
 *                                        button; assignee ≠ reviewer, so
 *                                        that's the only action they can take)
 *   - Anyone else                       → parent hides the bar entirely
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
  currentStatus: "OPEN" | "IN_REINSPECTION" | "RESOLVED";
  expectedUpdatedAt: string;
  projectId: string;
  iCanReview: boolean;
  iAmAssignee: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(status: "OPEN" | "IN_REINSPECTION" | "RESOLVED") {
    setError(null);
    const res = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      setError("Someone updated this snag while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }
    // Back to the tab that matches the NEW status — Open → open list,
    // Reinspection → reinspection list, Resolved → resolved list. So the
    // engineer sees the snag reappear where it now belongs.
    const tab =
      status === "RESOLVED" ? "resolved" : status === "IN_REINSPECTION" ? "reinspection" : "open";
    startTransition(() => {
      router.push(`/mobile/${projectId}/issue?tab=${tab}`);
      router.refresh();
    });
  }

  // Assignee (contractor) can only signal "please re-check" from OPEN. Any
  // other combination for a non-reviewer means we've got no action to show.
  const showAssigneeReinspect = iAmAssignee && !iCanReview && currentStatus === "OPEN";

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
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Mark resolved
        </button>
      )}

      {iCanReview && currentStatus === "IN_REINSPECTION" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch("OPEN")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Reopen
          </button>
          <button
            type="button"
            onClick={() => patch("RESOLVED")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Mark resolved
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
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ready for re-inspection
        </button>
      )}
    </div>
  );
}
