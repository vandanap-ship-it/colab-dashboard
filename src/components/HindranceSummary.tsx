"use client";

import { useCallback, useEffect, useState } from "react";
import PhotoStrip from "./PhotoStrip";
import TrashButton from "./TrashButton";
import { formatDayMonthYear as fmt } from "@/lib/dates";

type Hindrance = {
  id: string;
  description: string;
  startDate: string;
  resolvedDate: string | null;
  daysImpact: number | null;
  status: string;
  createdBy: { id: string; name: string };
  wbsNode: { id: string; name: string; taskCode: string } | null;
  photos: { id: string; url: string }[];
};

export default function HindranceSummary({ projectId, canResolve }: { projectId: string; canResolve: boolean }) {
  const [hindrances, setHindrances] = useState<Hindrance[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    const url = `/api/hindrances?projectId=${projectId}` + (showResolved ? "" : "&status=OPEN");
    try {
      const res = await fetch(url, { cache: "no-store" });
      setHindrances(res.ok ? (await res.json()).hindrances ?? [] : []);
    } catch {
      setHindrances([]);
    }
  }, [projectId, showResolved]);

  useEffect(() => { load(); }, [load]);

  async function resolve(h: Hindrance) {
    const res = await fetch(`/api/hindrances/${h.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    if (res.ok) load();
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
          Hindrance Summary
        </h2>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Include resolved
        </label>
      </div>
      {hindrances === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : hindrances.length === 0 ? (
        <p className="text-stone-400 text-2xl font-semibold uppercase opacity-30">No Hindrance Registered</p>
      ) : (
        <ul className="space-y-2">
          {hindrances.map((h) => (
            <li
              key={h.id}
              className="rounded-lg border border-stone-100 bg-ivory p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        h.status === "OPEN"
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {h.status}
                    </span>
                    {h.daysImpact != null && (
                      <span className="text-xs text-stone-500">~{h.daysImpact} day impact</span>
                    )}
                  </div>
                  <p className="text-sm text-stone-900 mt-1">{h.description}</p>
                  <p className="text-[10px] text-stone-500 mt-1">
                    Started {fmt(h.startDate)} · {h.createdBy.name}
                    {h.wbsNode && <> · {h.wbsNode.name}</>}
                  </p>
                  {h.photos.length > 0 && (
                    <div className="mt-2">
                      <PhotoStrip photos={h.photos} size="md" maxInline={6} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canResolve && h.status === "OPEN" && (
                    <button
                      onClick={() => resolve(h)}
                      className="text-xs rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-100 whitespace-nowrap"
                    >
                      Resolve
                    </button>
                  )}
                  <TrashButton
                    url={`/api/hindrances/${h.id}`}
                    kind="hindrance"
                    label={h.description}
                    onDeleted={load}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
