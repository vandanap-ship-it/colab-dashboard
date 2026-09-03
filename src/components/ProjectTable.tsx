"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Building2,
  FolderPlus,
  Loader2,
  Pencil,
  Search,
} from "lucide-react";
import NewProjectModal, { type EditableProject } from "./NewProjectModal";
import type { ProjectSummary } from "@/app/api/projects/summary/route";
import { projectTypeLabel } from "@/lib/projectTypes";

// ---------------------------------------------------------------------------
// Formatting helpers — kept in one place so the whole table renders
// consistently and cell-level logic stays declarative.
// ---------------------------------------------------------------------------
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}
function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// Column definitions — each cell renderer takes the row and returns a node.
// Sorting uses a separate sort-value function so numeric columns stay
// stable when data cells are formatted as strings.
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc";
type SortKey =
  | "name"
  | "projectType"
  | "progressPercent"
  | "startDate"
  | "endDate"
  | "projectedEndDate"
  | "totalDelayDays"
  | "openHindrances"
  | "activePermits"
  | "actualLabourToday"
  | "openIssuesAndActions";

interface Column {
  key: SortKey | null; // null = not sortable
  label: string;
  sticky?: boolean; // pin left (name)
  align?: "left" | "right";
  width?: string;
  render: (row: ProjectSummary) => React.ReactNode;
  sortValue?: (row: ProjectSummary) => string | number;
}

// Aggregated "issues & actions" — sum of the three open counts.
function actionCount(r: ProjectSummary): number {
  return r.openIssues + r.openConcerns + r.openHindrances;
}

/** Adapt a ProjectSummary row into the modal's editable shape. */
function toEditable(r: ProjectSummary): EditableProject {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    status: r.status,
    projectType: r.projectType,
    logoUrl: r.logoUrl,
    startDate: r.startDate,
    endDate: r.endDate,
    address: null, // not returned by /summary — the edit modal defaults blank
    updatedAt: r.updatedAt,
  };
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Project",
    sticky: true,
    align: "left",
    width: "260px",
    render: (r) => (
      <Link
        href={`/projects/${r.id}/overview`}
        className="flex items-center gap-3 min-w-0 group"
      >
        {r.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.logoUrl} alt="" className="w-9 h-9 rounded object-cover border border-stone-200 flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded bg-stone-100 border border-stone-200 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-stone-400" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900 truncate group-hover:text-amber-700 transition-colors">
            {r.name}
          </div>
          {r.code && (
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 truncate">
              {r.code}
            </div>
          )}
        </div>
      </Link>
    ),
    sortValue: (r) => r.name.toLowerCase(),
  },
  {
    key: "projectType",
    label: "Type",
    width: "140px",
    render: (r) => <span className="text-sm text-stone-700">{projectTypeLabel(r.projectType)}</span>,
    sortValue: (r) => r.projectType ?? "",
  },
  {
    key: "progressPercent",
    label: "Physical Progress",
    align: "right",
    width: "160px",
    render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="w-16 h-1.5 rounded-full bg-stone-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${Math.min(100, r.progressPercent)}%` }}
          />
        </div>
        <span className="text-sm font-semibold tabular-nums text-stone-900">{fmtPct(r.progressPercent)}</span>
      </div>
    ),
    sortValue: (r) => r.progressPercent,
  },
  {
    key: "startDate",
    label: "Plan start",
    width: "120px",
    render: (r) => <span className="text-sm text-stone-700 tabular-nums">{fmtDate(r.startDate)}</span>,
    sortValue: (r) => r.startDate ?? "",
  },
  {
    key: "endDate",
    label: "Plan end",
    width: "120px",
    render: (r) => <span className="text-sm text-stone-700 tabular-nums">{fmtDate(r.endDate)}</span>,
    sortValue: (r) => r.endDate ?? "",
  },
  {
    key: "projectedEndDate",
    label: "Projected end",
    width: "130px",
    render: (r) => {
      const projected = r.projectedEndDate ?? r.endDate;
      const slip = r.totalDelayDays;
      return (
        <span className={`text-sm tabular-nums ${slip > 0 ? "text-amber-700 font-semibold" : "text-stone-700"}`}>
          {fmtDate(projected)}
        </span>
      );
    },
    sortValue: (r) => r.projectedEndDate ?? r.endDate ?? "",
  },
  {
    key: "totalDelayDays",
    label: "Total delay",
    align: "right",
    width: "110px",
    render: (r) => (
      <span
        className={`text-sm font-semibold tabular-nums ${
          r.totalDelayDays > 30 ? "text-red-700" : r.totalDelayDays > 0 ? "text-amber-700" : "text-emerald-700"
        }`}
      >
        {r.totalDelayDays > 0 ? `+${r.totalDelayDays}d` : r.totalDelayDays === 0 ? "0d" : `${r.totalDelayDays}d`}
      </span>
    ),
    sortValue: (r) => r.totalDelayDays,
  },
  {
    key: "openHindrances",
    label: "Hindrances",
    align: "right",
    width: "100px",
    render: (r) => (
      <span className={`text-sm tabular-nums ${r.openHindrances > 0 ? "text-amber-700 font-semibold" : "text-stone-500"}`}>
        {r.openHindrances}
      </span>
    ),
    sortValue: (r) => r.openHindrances,
  },
  {
    key: "activePermits",
    label: "Active permits",
    align: "right",
    width: "120px",
    render: (r) => <span className="text-sm tabular-nums text-stone-700">{r.activePermits}</span>,
    sortValue: (r) => r.activePermits,
  },
  {
    key: null,
    label: "Cost",
    align: "right",
    width: "120px",
    render: (r) => <span className="text-sm tabular-nums text-stone-400 italic">{fmtCurrency(r.costTotal)}</span>,
  },
  {
    key: null,
    label: "Fin. progress",
    align: "right",
    width: "120px",
    render: (r) => <span className="text-sm tabular-nums text-stone-400 italic">{fmtPct(r.financialProgressPct)}</span>,
  },
  {
    key: null,
    label: "Planned labour (today)",
    align: "right",
    width: "160px",
    render: (r) => (
      <span className="text-sm tabular-nums text-stone-700">
        {r.plannedLabourToday == null ? "—" : r.plannedLabourToday}
      </span>
    ),
  },
  {
    key: "actualLabourToday",
    label: "Actual labour (today)",
    align: "right",
    width: "160px",
    render: (r) => {
      const planned = r.plannedLabourToday;
      const actual = r.actualLabourToday;
      let cls = "text-stone-700";
      if (planned != null && planned > 0) {
        cls = actual > planned ? "text-emerald-700 font-semibold" : actual < planned ? "text-red-700 font-semibold" : "text-stone-700";
      }
      return <span className={`text-sm tabular-nums ${cls}`}>{fmtInt(actual)}</span>;
    },
    sortValue: (r) => r.actualLabourToday,
  },
  {
    key: "openIssuesAndActions",
    label: "Issues & actions",
    align: "right",
    width: "130px",
    render: (r) => {
      const n = actionCount(r);
      return (
        <span className={`text-sm tabular-nums ${n > 0 ? "text-stone-900 font-semibold" : "text-stone-500"}`}>
          {n}
        </span>
      );
    },
    sortValue: (r) => actionCount(r),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectTable({ canCreate }: { canCreate: boolean }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditableProject | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects/summary", { cache: "no-store" });
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

  const filtered = useMemo(() => {
    if (projects == null) return null;
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.projectType ?? "").toLowerCase().includes(q) ||
        projectTypeLabel(p.projectType).toLowerCase().includes(q)
      );
    });
  }, [projects, query]);

  const sorted = useMemo(() => {
    if (filtered == null) return null;
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Projects</h1>
          <p className="text-sm text-stone-500 mt-1">
            All projects in your portfolio. Click a row to open the project dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="pl-9 pr-3 py-2 text-sm rounded-lg border border-stone-300 bg-white w-56 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </label>
          {canCreate && (
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 transition-colors shadow-sm"
            >
              <FolderPlus className="w-4 h-4" />
              New Project
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {sorted === null ? (
        <div className="rounded-xl border border-stone-200 bg-white p-10 text-center">
          <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
          <p className="text-sm text-stone-500 mt-3">Loading projects…</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-300 bg-white/40 p-12 text-center">
          <Building2 className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-stone-900">
            {query ? "No matches" : "No projects yet"}
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            {query
              ? "Try a different search."
              : canCreate
              ? "Click New Project to add your first."
              : "Ask an admin to create the first project."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          {/* Horizontal scroll on narrow screens — the table is wide by design.
              Rounded card is preserved via overflow-hidden on the wrapper. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  {COLUMNS.map((col) => {
                    const isActive = col.key != null && sortKey === col.key;
                    return (
                      <th
                        key={col.label}
                        style={{ width: col.width, minWidth: col.width }}
                        className={`
                          px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600
                          ${col.align === "right" ? "text-right" : "text-left"}
                          ${col.sticky ? "sticky left-0 bg-stone-50 z-10" : ""}
                        `}
                      >
                        {col.key ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key!)}
                            className={`inline-flex items-center gap-1 ${col.align === "right" ? "flex-row-reverse" : ""} ${isActive ? "text-stone-900" : "hover:text-stone-900"}`}
                          >
                            {col.label}
                            <ArrowUpDown className={`w-3 h-3 ${isActive ? "text-stone-900" : "text-stone-400"}`} />
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    );
                  })}
                  {canCreate && (
                    <th className="px-3 py-2.5 w-12" aria-label="Actions" />
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((row) => (
                  <tr key={row.id} className="hover:bg-stone-50/60 transition-colors">
                    {COLUMNS.map((col) => (
                      <td
                        key={col.label}
                        style={{ width: col.width, minWidth: col.width }}
                        className={`
                          px-4 py-3
                          ${col.align === "right" ? "text-right" : "text-left"}
                          ${col.sticky ? "sticky left-0 bg-white z-10" : ""}
                        `}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                    {canCreate && (
                      <td className="px-3 py-3 text-right w-12">
                        <button
                          type="button"
                          onClick={() => setEditing(toEditable(row))}
                          className="p-1.5 rounded hover:bg-stone-100 text-stone-500 hover:text-stone-900 transition-colors"
                          title="Edit project"
                          aria-label={`Edit ${row.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

      {editing && (
        <NewProjectModal
          existing={editing}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
