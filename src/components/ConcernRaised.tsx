"use client";

import { useCallback, useEffect, useState } from "react";
import PhotoStrip from "./PhotoStrip";
import TrashButton from "./TrashButton";

type Concern = {
  id: string;
  description: string;
  status: string;
  createdAt: string;
  raisedBy: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
  wbsNode: { id: string; name: string; taskCode: string } | null;
  photos: { id: string; url: string }[];
};

const STATUSES = ["PENDING", "READ", "RESOLVED", "TASK_ASSIGNED"] as const;
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  READ: "Read",
  RESOLVED: "Resolved",
  TASK_ASSIGNED: "Task Assigned",
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function ConcernRaised({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [tab, setTab] = useState<(typeof STATUSES)[number]>("PENDING");
  const [concerns, setConcerns] = useState<Concern[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, READ: 0, RESOLVED: 0, TASK_ASSIGNED: 0 });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/concerns?projectId=${projectId}&status=${tab}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConcerns(data.concerns ?? []);
        setCounts(data.counts ?? { PENDING: 0, READ: 0, RESOLVED: 0, TASK_ASSIGNED: 0 });
      } else {
        setConcerns([]);
      }
    } catch {
      setConcerns([]);
    }
  }, [projectId, tab]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(c: Concern, status: string) {
    const res = await fetch(`/api/concerns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load();
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">
        Concern Raised
      </h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full ${
              tab === s
                ? "bg-stone-900 text-white"
                : "bg-stone-100 text-stone-600"
            }`}
          >
            {STATUS_LABELS[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {concerns === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : concerns.length === 0 ? (
        <p className="text-sm text-stone-500">No concerns in this status.</p>
      ) : (
        <ul className="space-y-2">
          {concerns.map((c) => (
            <li key={c.id} className="rounded-lg border border-stone-100 bg-ivory p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-stone-900">{c.description}</p>
                  <p className="text-[10px] text-stone-500 mt-1">
                    {fmt(c.createdAt)} · {c.raisedBy.name}
                    {c.wbsNode && <> · {c.wbsNode.name}</>}
                    {c.assignedTo && <> · → {c.assignedTo.name}</>}
                  </p>
                  {c.photos.length > 0 && (
                    <div className="mt-2">
                      <PhotoStrip photos={c.photos} size="md" maxInline={6} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canManage && (
                    <select
                      value={c.status}
                      onChange={(e) => setStatus(c, e.target.value)}
                      className="text-xs rounded-md border border-stone-200 bg-white px-2 py-1"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                  <TrashButton
                    url={`/api/concerns/${c.id}`}
                    kind="concern"
                    label={c.description}
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
