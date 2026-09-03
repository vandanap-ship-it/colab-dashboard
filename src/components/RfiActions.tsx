"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RfiStatus } from "@/lib/rfi";
import TrashButton from "./TrashButton";

export interface RfiActionsProps {
  rfiId: string;
  currentStatus: RfiStatus;
  currentAssigneeId: string | null;
  assignableUsers: Array<{ id: string; name: string }>;
  canAnswer: boolean;
}

export default function RfiActions({
  rfiId,
  currentStatus,
  currentAssigneeId,
  assignableUsers,
  canAnswer,
}: RfiActionsProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [assignedToId, setAssignedToId] = useState(currentAssigneeId ?? "");
  const [busy, setBusy] = useState<null | "assign" | "answer" | "close" | "reopen">(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, action: typeof busy) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/rfi/${rfiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? "Request failed");
      }
      router.refresh();
      setAnswer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const inputCls = "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900";
  const btnPrimary = "inline-flex items-center rounded-lg bg-stone-900 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-stone-800 disabled:opacity-50";
  const btnSecondary = "inline-flex items-center rounded-lg border border-stone-200 bg-white text-stone-700 px-3.5 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-50";

  return (
    <div className="space-y-5">
      {/* Assign / reassign */}
      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Assignee</span>
        <div className="flex gap-2 mt-1">
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            className={`${inputCls} max-w-xs`}
          >
            <option value="">— unassigned —</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy != null || assignedToId === (currentAssigneeId ?? "")}
            onClick={() => patch({ assignedToId: assignedToId || null }, "assign")}
          >
            {busy === "assign" ? "Saving..." : "Save assignee"}
          </button>
        </div>
      </div>

      {/* Answer */}
      {canAnswer && currentStatus !== "CLOSED" && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
            {currentStatus === "OPEN" ? "Answer" : "Update answer"}
          </span>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Explain the resolution. Reference drawings, dimensions, or standards."
            className={`${inputCls} mt-1 min-h-[100px]`}
            maxLength={4000}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy != null || answer.trim().length === 0}
              onClick={() => patch({ answer }, "answer")}
            >
              {busy === "answer" ? "Posting..." : "Post answer"}
            </button>
            <span className="text-[10px] text-stone-400">{answer.length} / 4000</span>
          </div>
        </div>
      )}

      {/* Close / reopen / trash */}
      <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
        {currentStatus !== "CLOSED" && (
          <button
            type="button"
            className={btnSecondary}
            disabled={busy != null}
            onClick={() => patch({ status: "CLOSED" }, "close")}
          >
            {busy === "close" ? "Closing..." : "Close RFI"}
          </button>
        )}
        {currentStatus === "CLOSED" && (
          <button
            type="button"
            className={btnSecondary}
            disabled={busy != null}
            onClick={() => patch({ status: "OPEN" }, "reopen")}
          >
            {busy === "reopen" ? "Reopening..." : "Reopen RFI"}
          </button>
        )}
        <span className="ml-auto" />
        <TrashButton
          url={`/api/rfi/${rfiId}`}
          kind="RFI"
          onDeleted={() => router.push("../rfi")}
          showLabel
        />
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
