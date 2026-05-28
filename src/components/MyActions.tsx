"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Concern = {
  id: string;
  description: string;
  status: string;
  createdAt: string;
  raisedBy: { id: string; name: string };
  project: { id: string; name: string };
  wbsNode: { id: string; name: string } | null;
};

type Inspection = {
  id: string;
  title: string;
  createdAt: string;
  filledBy: { id: string; name: string };
  project: { id: string; name: string };
  wbsNode: { id: string; name: string } | null;
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function MyActions({ projectId }: { projectId?: string }) {
  const [data, setData] = useState<{ concerns: Concern[]; inspectionsToReview: Inspection[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    const url = projectId ? `/api/my-actions?projectId=${projectId}` : "/api/my-actions";
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setData({ concerns: d.concerns ?? [], inspectionsToReview: d.inspectionsToReview ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
        <p className="text-sm text-stone-600">Couldn&apos;t load your actions.</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-2 text-sm font-medium text-stone-900 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const total = data.concerns.length + data.inspectionsToReview.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">My Actions</h1>
        <p className="text-sm text-stone-500 mt-1">
          {total === 0 ? "All clear." : `${total} item${total === 1 ? "" : "s"} need your attention.`}
        </p>
      </div>

      {data.inspectionsToReview.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">
            Inspections awaiting review ({data.inspectionsToReview.length})
          </h2>
          <ul className="space-y-2">
            {data.inspectionsToReview.map((insp) => (
              <li key={insp.id} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-900">{insp.title}</p>
                    <p className="text-[10px] text-stone-500 mt-0.5">
                      {fmt(insp.createdAt)} · {insp.filledBy.name} · {insp.project.name}
                      {insp.wbsNode && <> · {insp.wbsNode.name}</>}
                    </p>
                  </div>
                  <Link
                    href={`/projects/${insp.project.id}#qaqc`}
                    className="text-xs rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-100 whitespace-nowrap"
                  >
                    Review →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.concerns.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">
            Concerns assigned to me ({data.concerns.length})
          </h2>
          <ul className="space-y-2">
            {data.concerns.map((c) => (
              <li key={c.id} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                <p className="text-sm text-stone-900">{c.description}</p>
                <p className="text-[10px] text-stone-500 mt-1">
                  {fmt(c.createdAt)} · raised by {c.raisedBy.name} · {c.project.name}
                  {c.wbsNode && <> · {c.wbsNode.name}</>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {total === 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center">
          <p className="text-stone-500">Nothing on your plate. 🎉</p>
        </div>
      )}
    </div>
  );
}
