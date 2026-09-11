"use client";

import { useRouter } from "next/navigation";

/**
 * Shared "Saved · Add another / Back to home" success state for every
 * mobile Create form (Progress, Permit, Inspection, Manpower, Expense,
 * and the ReportForm-based flows: Hindrance, Snag, Concern).
 *
 * Rationale (Shraddha, Sep 11): "They won't be adding just one progress
 * or one permit; they'll be adding quite a few. So the flow cannot be
 * right." — the old behaviour of `router.push('/mobile/{projectId}')`
 * on save booted the engineer back to Home after every save, forcing
 * them to re-tap the same CTA to log the next entry.
 *
 * This card:
 *   - Confirms the save visibly (large green checkmark)
 *   - Offers "Add another" as the primary action (resets the form via
 *     the caller-provided onAddAnother callback)
 *   - Offers "Back to home" as the secondary action
 *
 * Kept dumb on purpose: the caller owns form-state resets. This
 * component just renders the success surface and dispatches the two
 * user choices.
 */
export default function SaveSuccessCard({
  title,
  detail,
  projectId,
  onAddAnother,
  queued = false,
}: {
  /** Big header line, e.g. "Progress saved", "Permit raised". */
  title: string;
  /** Optional one-line preview or reassurance under the title. */
  detail?: string;
  /** Where "Back to home" navigates. Usually /mobile/{projectId}. */
  projectId: string;
  /** Callback the "Add another" button invokes. Should reset the caller
   *  form's state (fields, photos, error, etc.) so the engineer can
   *  immediately submit another entry without navigating anywhere. */
  onAddAnother: () => void;
  /** True when the save was queued locally (offline). Adjusts the
   *  detail line so the engineer knows their entry is on the device
   *  and will sync later — not lost. */
  queued?: boolean;
}) {
  const router = useRouter();

  return (
    <div className="px-4 py-8 space-y-6">
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-2xl mb-3">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-emerald-900">{title}</h2>
        {queued ? (
          <p className="text-sm text-emerald-800 mt-2">
            You&apos;re offline — saved on this device, will sync as soon as you&apos;re
            back on signal.
          </p>
        ) : detail ? (
          <p className="text-sm text-emerald-800 mt-2">{detail}</p>
        ) : (
          <p className="text-sm text-emerald-800 mt-2">
            Saved to the project. Your team can now see it.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        <button
          type="button"
          onClick={onAddAnother}
          className="rounded-xl bg-stone-900 text-white text-base font-medium py-4 active:scale-[0.99] transition-all"
        >
          Add another
        </button>
        <button
          type="button"
          onClick={() => router.push(`/mobile/${projectId}`)}
          className="rounded-xl bg-white border border-stone-200 text-stone-900 text-base font-medium py-4 active:scale-[0.99] transition-all"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
