"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Building2, FolderPlus, Loader2 } from "lucide-react";
import NewProjectModal from "./NewProjectModal";

type Project = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; username: string };
};

const STATUS_STYLES: Record<string, { dot: string; pill: string; label: string }> = {
  PLANNING: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 ring-amber-200", label: "Planning" },
  ACTIVE: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 ring-emerald-200", label: "Active" },
  ON_HOLD: { dot: "bg-stone-500", pill: "bg-stone-50 text-stone-700 ring-stone-200", label: "On hold" },
  COMPLETED: { dot: "bg-blue-500", pill: "bg-blue-50 text-blue-800 ring-blue-200", label: "Completed" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ProjectList({ canCreate }: { canCreate: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Projects</h1>
          <p className="text-sm text-stone-500 mt-1">
            All projects in your portfolio.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 transition-colors shadow-soft"
          >
            <FolderPlus className="w-4 h-4" />
            New Project
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {projects === null ? (
        <div className="rounded-xl border border-stone-200 bg-white p-10 text-center">
          <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
          <p className="text-sm text-stone-500 mt-3">Loading projects…</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-300 bg-white/40 p-12 text-center">
          <Building2 className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-stone-900">No projects yet</h3>
          <p className="text-sm text-stone-500 mt-1 max-w-sm mx-auto">
            {canCreate
              ? "Spin up your first project to start logging schedules and progress."
              : "An admin needs to create a project before you can log progress."}
          </p>
          {canCreate && (
            <button
              onClick={() => setModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              Create project
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3">
          {projects.map((p) => {
            const status = STATUS_STYLES[p.status] ?? STATUS_STYLES.PLANNING;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="group block rounded-xl border border-stone-200 bg-white hover:border-stone-300 hover:shadow-card transition-all"
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-11 h-11 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500 shrink-0 group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-stone-900 truncate">{p.name}</h3>
                        {p.code && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                            {p.code}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${status.pill}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1">
                        {formatDate(p.startDate)} → {formatDate(p.endDate)} · Created by {p.createdBy.name}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-stone-300 group-hover:text-stone-900 group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
