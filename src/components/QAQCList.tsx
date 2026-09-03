"use client";

import { useCallback, useEffect, useState } from "react";
import PhotoStrip from "./PhotoStrip";
import TrashButton from "./TrashButton";
import { formatDayMonthYear as fmt } from "@/lib/dates";

type Item = { id: string; label: string; passed: boolean; notes: string | null; orderIndex: number };

type Inspection = {
  id: string;
  title: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string; // echoed on PATCH for the server's concurrency guard
  filledBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  wbsNode: { id: string; name: string; taskCode: string } | null;
  items: Item[];
  photos: { id: string; url: string }[];
};

const STATUSES = ["IN_REVIEW", "PASSED", "REJECTED"] as const;
const STATUS_LABELS: Record<string, string> = {
  IN_REVIEW: "In Review",
  PASSED: "Passed",
  REJECTED: "Rejected",
};
const STATUS_STYLES: Record<string, string> = {
  IN_REVIEW: "bg-amber-100 text-amber-700",
  PASSED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};


export default function QAQCList({ projectId, canReview }: { projectId: string; canReview: boolean }) {
  const [tab, setTab] = useState<(typeof STATUSES)[number]>("IN_REVIEW");
  const [inspections, setInspections] = useState<Inspection[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ IN_REVIEW: 0, PASSED: 0, REJECTED: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectionDraft, setRejectionDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspections?projectId=${projectId}&status=${tab}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setInspections(data.inspections ?? []);
        setCounts(data.counts ?? { IN_REVIEW: 0, PASSED: 0, REJECTED: 0 });
      } else {
        setInspections([]);
      }
    } catch {
      setInspections([]);
    }
  }, [projectId, tab]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(insp: Inspection, status: string, rejectionReason?: string) {
    const res = await fetch(`/api/inspections/${insp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, rejectionReason, expectedUpdatedAt: insp.updatedAt }),
    });
    if (res.ok) {
      load();
      setExpandedId(null);
      return;
    }
    if (res.status === 409) {
      alert("Someone else just reviewed this inspection. Refreshing so you see the latest.");
      load();
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">QA / QC</h2>
        <span className="text-xs text-stone-500">
          {counts.PASSED} passed of {counts.IN_REVIEW + counts.PASSED + counts.REJECTED}
        </span>
      </div>

      <div className="flex gap-2 mb-3">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full ${
              tab === s ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
            }`}
          >
            {STATUS_LABELS[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {inspections === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : inspections.length === 0 ? (
        <p className="text-sm text-stone-500">No inspections in this status.</p>
      ) : (
        <ul className="space-y-2">
          {inspections.map((insp) => {
            const passed = insp.items.filter((i) => i.passed).length;
            const total = insp.items.length;
            const rate = total > 0 ? (passed / total) * 100 : 0;
            const isOpen = expandedId === insp.id;
            return (
              <li key={insp.id} className="rounded-lg border border-stone-100 bg-stone-50">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : insp.id)}
                  className="w-full text-left p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[insp.status] ?? ""}`}
                      >
                        {STATUS_LABELS[insp.status]}
                      </span>
                      <span className="text-xs text-stone-500">
                        {passed}/{total} pass · {rate.toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm font-medium text-stone-900 mt-1">{insp.title}</p>
                    <p className="text-[10px] text-stone-500 mt-0.5">
                      {fmt(insp.createdAt)} · {insp.filledBy.name}
                      {insp.wbsNode && <> · {insp.wbsNode.name}</>}
                      {insp.reviewedBy && <> · reviewed by {insp.reviewedBy.name}</>}
                    </p>
                  </div>
                  <span className="text-stone-400 text-sm">{isOpen ? "▴" : "▾"}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    <ul className="space-y-1">
                      {insp.items.map((it) => (
                        <li
                          key={it.id}
                          className="flex items-start gap-2 text-xs bg-white rounded p-2 border border-stone-100"
                        >
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] ${
                              it.passed ? "bg-emerald-500" : "bg-red-500"
                            }`}
                          >
                            {it.passed ? "✓" : "✕"}
                          </span>
                          <div className="flex-1">
                            <div className={it.passed ? "text-stone-700" : "text-red-700 font-medium"}>{it.label}</div>
                            {it.notes && <div className="text-stone-500 mt-0.5">{it.notes}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {insp.photos.length > 0 && (
                      <PhotoStrip photos={insp.photos} size="lg" maxInline={8} />
                    )}
                    {insp.rejectionReason && (
                      <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                        Rejected: {insp.rejectionReason}
                      </p>
                    )}
                    {canReview && insp.status === "IN_REVIEW" && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={rejectionDraft[insp.id] ?? ""}
                          onChange={(e) => setRejectionDraft((s) => ({ ...s, [insp.id]: e.target.value }))}
                          placeholder="Rejection reason (required for reject)"
                          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setStatus(insp, "PASSED")}
                            className="flex-1 text-xs font-medium rounded-full py-1.5 bg-emerald-500 text-white"
                          >
                            ✓ Pass
                          </button>
                          <button
                            type="button"
                            disabled={!(rejectionDraft[insp.id] ?? "").trim()}
                            onClick={() => setStatus(insp, "REJECTED", rejectionDraft[insp.id])}
                            className="flex-1 text-xs font-medium rounded-full py-1.5 bg-red-500 text-white disabled:opacity-40"
                          >
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Trash — server enforces filler-or-admin. Non-filler
                        non-admin users see a 403 which TrashButton surfaces. */}
                    <div className="flex justify-end pt-1">
                      <TrashButton
                        url={`/api/inspections/${insp.id}`}
                        kind="inspection"
                        label={insp.title}
                        showLabel
                        onDeleted={load}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
