"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@/app/api/projects/summary/route";

export default function SwitchProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setProjects(null);
    setError(null);
    fetch("/api/projects/summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { projects: ProjectSummary[] }) => setProjects(d.projects))
      .catch((e: Error) => setError(e.message));
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)),
    );
  }, [projects, search]);

  const summary = useMemo(() => {
    if (!projects || projects.length === 0) {
      return { count: 0, avgProgress: 0 };
    }
    const total = projects.reduce((s, p) => s + p.progressPercent, 0);
    return {
      count: projects.length,
      avgProgress: Math.round((total / projects.length) * 10) / 10,
    };
  }, [projects]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-stone-200 shadow-xl m-6 w-full max-w-6xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-stone-900">Switch Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-3 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="flex-1 min-w-[200px] rounded-full border border-stone-300 px-4 py-1.5 text-sm focus:outline-none focus:border-stone-900"
          />
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span className="rounded-full bg-stone-100 px-3 py-1">
              Total Projects: <strong className="text-stone-900">{summary.count}</strong>
            </span>
            <span className="rounded-full bg-stone-100 px-3 py-1">
              Avg Progress:{" "}
              <strong className="text-stone-900">{summary.avgProgress}%</strong>
            </span>
          </div>
        </div>

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {error && (
            <p className="text-sm text-red-600">Could not load projects: {error}</p>
          )}
          {!error && projects === null && (
            <p className="text-sm text-stone-500">Loading…</p>
          )}
          {!error && projects && filtered.length === 0 && (
            <p className="text-sm text-stone-500 text-center py-8">
              {projects.length === 0 ? "No projects yet." : "No projects match your search."}
            </p>
          )}
          {!error && filtered.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <th className="text-left font-medium py-2 pr-3">#</th>
                  <th className="text-left font-medium py-2 pr-3">Project</th>
                  <th className="text-left font-medium py-2 pr-3">Status</th>
                  <th className="text-right font-medium py-2 pr-3">Progress</th>
                  <th className="text-right font-medium py-2 pr-3">Activities</th>
                  <th className="text-right font-medium py-2 pr-3">Open Concerns</th>
                  <th className="text-right font-medium py-2 pr-3">Open Snags</th>
                  <th className="text-right font-medium py-2 pr-3">Open Hindrances</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr
                    key={p.id}
                    className="border-b border-stone-100 last:border-b-0 hover:bg-ivory"
                  >
                    <td className="py-2 pr-3 text-stone-500">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/projects/${p.id}/snapshot`}
                        className="font-medium text-stone-900 hover:underline"
                        onClick={onClose}
                      >
                        {p.name}
                      </Link>
                      {p.code && (
                        <span className="ml-2 text-[10px] font-mono uppercase text-stone-500 bg-stone-100 px-1 py-0.5 rounded">
                          {p.code}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs uppercase tracking-wider text-stone-600">
                      {p.status.replace("_", " ")}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.progressPercent}%
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-500">
                      {p.totalActivities}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.openConcerns}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.openIssues}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.openHindrances}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
