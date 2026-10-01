"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

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
  moduleFilter,
}: {
  inspectionId: string;
  currentStatus:
    | "IN_REVIEW"
    | "PASSED"
    | "REJECTED"
    // Colab 2026-10-01 parity 5th state (HSE Inspection Checklist).
    | "CONDITIONALLY_APPROVED";
  expectedUpdatedAt: string; // ISO of Inspection.updatedAt for the 409 guard
  projectId: string;
  /** Preserves the split-view context (?module=QAQC or ?module=SAFETY)
   *  on the post-review redirect so an EHS reviewer lands back on EHS
   *  Pending, not the combined feed. */
  moduleFilter?: "QAQC" | "SAFETY";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approveRemark, setApproveRemark] = useState("");
  // When true, the Approve & Close sheet's primary action submits
  // CONDITIONALLY_APPROVED instead of PASSED. Colab 2026-10-01 parity:
  // "approved but check the attached remarks for follow-ups". Toggle
  // sits inside the sheet rather than as a third top-bar button so
  // the primary two-choice (Reject | Approve) layout stays uncluttered
  // for the common QAQC WIR flow where this state isn't used.
  const [conditionalMode, setConditionalMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(
    status: "PASSED" | "REJECTED" | "CONDITIONALLY_APPROVED",
    remarkText?: string,
  ) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const rejectionReason = status === "REJECTED" ? remarkText : undefined;
    // Colab-parity Approve & Close sheet carries an optional remark.
    // The remark field is reused for the CONDITIONALLY_APPROVED path too
    // (that's the whole point — the remark is where the reviewer lists
    // the follow-ups the filler needs to action).
    const reviewRemark =
      status === "PASSED" || status === "CONDITIONALLY_APPROVED"
        ? approveRemark.trim() || undefined
        : undefined;
    const res = await fetch(`/api/inspections/${inspectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
        ...(reviewRemark ? { reviewRemark } : {}),
        expectedUpdatedAt,
      }),
    });
    if (res.status === 409) {
      setError("Someone updated this inspection while you were reading. Refreshing.");
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
    setApproveOpen(false);
    setApproveRemark("");
    setConditionalMode(false);
    // Land on the pending list for whichever module the reviewer opened
    // this inspection from — so an EHS reviewer lands on EHS Pending, a
    // QA/QC reviewer on QA/QC Pending, no jarring "combined" fallback.
    const backHref = `/mobile/${projectId}/qaqc?tab=pending${
      moduleFilter ? `&module=${moduleFilter}` : ""
    }`;
    startTransition(() => {
      router.push(backHref);
      router.refresh();
    });
  }

  // Already reviewed → don't offer buttons. Keep a subtle hint so the reviewer
  // knows why they can't act again from here. (A parked RESCHEDULED WIR is
  // filtered out one level up, in the detail page, so it never reaches this
  // component — the sandstone callout owns that state instead.)
  if (currentStatus !== "IN_REVIEW") {
    const label =
      currentStatus === "PASSED"
        ? "passed"
        : currentStatus === "CONDITIONALLY_APPROVED"
          ? "conditionally approved"
          : "rejected";
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center text-xs text-stone-500">
        This inspection has already been {label}.
        A fresh WIR is the way to raise it again.
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
      {/* Colab-parity primary actions: dark "Reject" (secondary) and amber
          "Approve & Close" (primary). Matches Colab's Approval Checklist
          bottom bar exactly — same wording, same colour weight, same
          two-button layout. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setRejectOpen(true)}
          disabled={isPending || saving}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => setApproveOpen(true)}
          disabled={isPending || saving}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Approve &amp; Close
        </button>
      </div>

      {/* Approve & Close sheet — Colab-parity: title matches the action,
          optional remark, Cancel + Ok. Added 2026-10-01: a
          "conditionally approved" toggle that flips the primary action
          to CONDITIONALLY_APPROVED (HSE Checklist 5th state — approved
          but with reviewer caveats to action). Toggle lives inside the
          sheet so the top bar stays a clean two-choice (Reject |
          Approve) for the common QAQC WIR flow. */}
      {approveOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <p className="font-serif text-lg font-semibold text-ink">
            {conditionalMode ? "Conditionally Approve" : "Approve & Close"}
          </p>
          <label className="block text-sm font-semibold text-stone-700">Remark</label>
          <textarea
            value={approveRemark}
            onChange={(e) => setApproveRemark(e.target.value)}
            placeholder={
              conditionalMode
                ? "List the follow-ups the filler needs to action"
                : "Enter Remark"
            }
            className="w-full min-h-20 resize-y rounded-lg border-2 border-dashed border-amber-300 bg-white p-2 text-sm"
            maxLength={1000}
          />
          <label className="flex items-start gap-2 text-sm text-stone-700 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={conditionalMode}
              onChange={(e) => setConditionalMode(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-ferrous-500"
            />
            <span>
              <span className="font-semibold">Conditionally approved</span>
              <span className="block text-[12px] text-stone-500">
                Approved, but the filler should action the remarks before the next cycle.
              </span>
            </span>
          </label>
          {/* Require a remark when conditionally approving — the whole
              point is to tell the filler what to look at next. Regular
              Approve & Close keeps the remark optional. */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setApproveOpen(false);
                setApproveRemark("");
                setConditionalMode(false);
                setError(null);
              }}
              className="rounded-xl bg-ink text-white text-sm font-semibold py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                patch(conditionalMode ? "CONDITIONALLY_APPROVED" : "PASSED")
              }
              disabled={
                isPending ||
                saving ||
                (conditionalMode && approveRemark.trim().length < 3)
              }
              className="rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Ok"}
            </button>
          </div>
        </div>
      )}

      {/* Reject-reason sheet — Colab-parity: title "Reject", placeholder
          "Enter Reject Remark", Cancel (dark) + Ok (amber) actions. */}
      {rejectOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <p className="font-serif text-lg font-semibold text-ink">Reject</p>
          <label className="block text-sm font-semibold text-stone-700">
            Remark
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter Reject Remark"
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
