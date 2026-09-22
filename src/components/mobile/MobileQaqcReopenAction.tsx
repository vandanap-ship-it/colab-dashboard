"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2 } from "lucide-react";

/**
 * "Reopen" affordance shown inside the sandstone reschedule callout on the
 * mobile inspection detail page. One tap → POST /api/inspections/[id]/reopen
 * → the WIR flips back to IN_REVIEW, the callout unmounts on refresh, and
 * the review action bar (Pass / Reject) reappears at the bottom.
 *
 * No confirmation modal on purpose: reopening is fully reversible (just
 * hit Reschedule again), and every extra tap on a mobile screen costs
 * more than it protects. If we later see accidental reopens in the audit
 * trail, a "hold to confirm" pattern here would be the fix.
 */
export default function MobileQaqcReopenAction({
  inspectionId,
  expectedUpdatedAt,
}: {
  inspectionId: string;
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/inspections/${inspectionId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt }),
      });
    } catch {
      setError("Network error — please try again.");
      return;
    }
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Someone updated this WIR while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to reopen.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={reopen}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-2 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
        Reopen now
      </button>
      {error && (
        <p className="mt-2 text-[12px] text-ferrous-600">{error}</p>
      )}
    </div>
  );
}
