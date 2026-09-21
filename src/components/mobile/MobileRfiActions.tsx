"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Send, Loader2, Lock } from "lucide-react";
import type { RfiStatus } from "@/lib/rfi";

/**
 * Sticky action bar on the mobile RFI detail — differs by status:
 *   - OPEN     → Answer sheet (multi-line) that PATCHes with answer +
 *                auto-transitions status to ANSWERED
 *   - ANSWERED → Close | Reopen buttons
 *   - CLOSED   → Reopen only
 *
 * The API's transition table already enforces which moves are legal, so
 * this bar is purely UX shaping — showing the buttons that make sense at
 * the current status. Answer is available at both OPEN and ANSWERED so
 * a consultant can revise their answer without reopening; the server
 * accepts an answer update at any non-closed status.
 */
export default function MobileRfiActions({
  rfiId,
  currentStatus,
  expectedUpdatedAt,
  projectId,
}: {
  rfiId: string;
  currentStatus: RfiStatus;
  expectedUpdatedAt: string;
  projectId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, backTab: "open" | "answered" | "closed") {
    setError(null);
    const res = await fetch(`/api/rfi/${rfiId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      setError("Someone updated this RFI while you were reading. Refreshing.");
      startTransition(() => router.refresh());
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }
    setAnswerOpen(false);
    setAnswer("");
    startTransition(() => {
      router.push(`/mobile/${projectId}/rfi?tab=${backTab}`);
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

      {/* Terminal state — reopen only. Kept as a whole-row button so it
          doesn't get confused with a primary action. */}
      {currentStatus === "CLOSED" && (
        <button
          type="button"
          onClick={() => patch({ status: "OPEN" }, "open")}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
        >
          <RotateCcw className="w-4 h-4" />
          Reopen
        </button>
      )}

      {currentStatus === "ANSWERED" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ status: "OPEN" }, "open")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Reopen
          </button>
          <button
            type="button"
            onClick={() => patch({ status: "CLOSED" }, "closed")}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-3 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Close
          </button>
        </div>
      )}

      {currentStatus === "OPEN" && !answerOpen && (
        <button
          type="button"
          onClick={() => setAnswerOpen(true)}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
        >
          <Send className="w-4 h-4" />
          Answer
        </button>
      )}

      {answerOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wide">
            Your answer
          </label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Note the resolution — send a drawing marker, name a decision, or point to the spec."
            className="w-full min-h-24 resize-y rounded-lg border border-stone-300 bg-white p-2 text-sm"
            maxLength={8000}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setAnswerOpen(false); setAnswer(""); setError(null); }}
              className="rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => patch({ answer: answer.trim() }, "answered")}
              disabled={isPending || answer.trim().length < 3}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Send answer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
