"use client";

import { useEffect, useState } from "react";

type Project = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  PLANNING: "bg-amber-500",
  ACTIVE: "bg-emerald-500",
  ON_HOLD: "bg-stone-400",
  COMPLETED: "bg-blue-500",
};

export default function MobileProjectPicker() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        if (!cancelled) setProjects(data.projects);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Pick a project</h1>
        <p className="text-sm text-stone-500 mt-1">Select the site you&apos;re logging against.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {projects === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center">
          <p className="text-sm text-stone-500">No projects assigned yet.</p>
          <p className="text-xs text-stone-400 mt-1">Ask a planner to create one.</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400 active:scale-[0.99] transition"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[p.status] ?? "bg-stone-300"}`}
                    aria-hidden
                  />
                  <span className="font-medium text-stone-900">{p.name}</span>
                </div>
                <p className="text-xs text-stone-500 mt-1 pl-5">
                  {p.status.replace("_", " ").toLowerCase()}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
