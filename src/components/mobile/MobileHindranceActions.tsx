"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Loader2 } from "lucide-react";

type HindranceStatus = "OPEN" | "RESOLVED";

/**
 * Sticky action bar on the mobile Hindrance detail. Reviewer-only —
 * resolving or reopening a hindrance is a planner action (site engineers
 * can raise them but not close them). Bar hides entirely for non-reviewers
 * (the parent decides whether to render the whole action bar container).
 *
 *   - OPEN     → Mark resolved
 *   - RESOLVED → Reopen
 */
export default function MobileHindranceActions({
  hindranceId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
}: {
  hindranceId: string;
  currentStatus: HindranceStatus;
  expectedUpdatedAt: string;
  projectId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(status: HindranceStatus, backTab: "open" | "resolved") {
    setError(null);
    const res = await fetch(`/api/hindrances/${hindranceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      setError("Someone updated this hindrance while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }
    startTransition(() => {
      router.push(`/mobile/${projectId}/hindrance?tab=${backTab}`);
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

      {currentStatus === "OPEN" && (
        <button
          type="button"
          onClick={() => patch("RESOLVED", "resolved")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Mark resolved
        </button>
      )}

      {currentStatus === "RESOLVED" && (
        <button
          type="button"
          onClick={() => patch("OPEN", "open")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
        >
          <RotateCcw className="w-4 h-4" />
          Reopen
        </button>
      )}
    </div>
  );
}
