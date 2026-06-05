"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import PhotoStrip, { type Photo } from "./PhotoStrip";
import { useToast } from "./Toast";

export type SnagRow = {
  id: string;
  description: string;
  category: string | null;
  severity: string | null;
  status: string;
  contractorName: string | null;
  activityName: string | null;
  location: string;
  createdByName: string | null;
  assignedToName: string | null;
  createdAt: string; // ISO
  photos: Photo[];
};

export type AssignableUser = { id: string; name: string };

const SEVERITY_PILL: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 ring-1 ring-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

const STATUS_PILL: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function csvEscape(value: string | null | undefined): string {
  const s = (value ?? "").replace(/"/g, '""');
  if (/[",\n]/.test(s)) return `"${s}"`;
  return s;
}

export default function SnagMasterTable({
  rows: initialRows,
  contractors,
  canManage,
  assignableUsers,
}: {
  rows: SnagRow[];
  contractors: string[];
  canManage: boolean;
  assignableUsers: AssignableUser[];
}) {
  const toast = useToast();
  const [rows, setRows] = useState<SnagRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("OPEN");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [contractorFilter, setContractorFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (severityFilter !== "ALL" && r.severity !== severityFilter) return false;
      if (contractorFilter !== "ALL" && r.contractorName !== contractorFilter) return false;
      if (q) {
        const haystack = [
          r.description,
          r.category ?? "",
          r.contractorName ?? "",
          r.activityName ?? "",
          r.location ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, severityFilter, contractorFilter, search]);

  const counts = useMemo(() => {
    const open = rows.filter((r) => r.status === "OPEN").length;
    const resolved = rows.filter((r) => r.status === "RESOLVED").length;
    return { all: rows.length, open, resolved };
  }, [rows]);

  function downloadCsv() {
    const header = [
      "ID",
      "Description",
      "Category",
      "Severity",
      "Status",
      "Contractor",
      "Activity",
      "Location",
      "Created By",
      "Assigned To",
      "Created At",
    ];
    const lines = filtered.map((r) =>
      [
        r.id,
        r.description,
        r.category,
        r.severity,
        r.status,
        r.contractorName,
        r.activityName,
        r.location,
        r.createdByName,
        r.assignedToName,
        new Date(r.createdAt).toISOString().slice(0, 10),
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snag-master-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function resolveSnag(id: string) {
    const ok = window.confirm("Mark this snag as resolved?");
    if (!ok) return;
    const res = await fetch(`/api/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    if (res.ok) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: "RESOLVED" } : r)));
      toast.success("Snag marked resolved.");
    } else {
      toast.error("Couldn't resolve. Try again.");
    }
  }

  async function assignSnag(id: string, userId: string) {
    const res = await fetch(`/api/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: userId || null }),
    });
    if (res.ok) {
      const user = assignableUsers.find((u) => u.id === userId);
      setRows((rs) =>
        rs.map((r) => (r.id === id ? { ...r, assignedToName: user?.name ?? null } : r)),
      );
    } else {
      toast.error("Couldn't update assignment.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex border border-stone-200 rounded-full p-1 gap-0.5 text-xs">
          {(
            [
              { key: "OPEN", label: `Open (${counts.open})` },
              { key: "RESOLVED", label: `Resolved (${counts.resolved})` },
              { key: "ALL", label: `All (${counts.all})` },
            ] as const
          ).map((opt) => {
            const active = statusFilter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatusFilter(opt.key)}
                className={
                  "px-3 py-1 rounded-full font-medium transition-colors " +
                  (active
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-100")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, category, location…"
              className="w-full rounded-md border border-stone-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
            />
          </div>
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-md border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:border-stone-900"
        >
          <option value="ALL">All severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={contractorFilter}
          onChange={(e) => setContractorFilter(e.target.value)}
          className="rounded-md border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:border-stone-900 max-w-[160px]"
        >
          <option value="ALL">All contractors</option>
          {contractors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex items-center gap-1.5 text-xs rounded-md border border-stone-300 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50 hover:border-stone-400 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download CSV
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-stone-50">
              <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                <Th align="left">Description</Th>
                <Th align="left">Category</Th>
                <Th>Severity</Th>
                <Th align="left">Contractor</Th>
                <Th align="left">Location</Th>
                <Th align="left">Photos</Th>
                <Th align="left">Assigned to</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                {canManage && <Th align="left">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 10 : 9} className="py-8 text-center text-stone-500">
                    No snags match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100">
                    <td className="py-2 px-3 text-stone-900 max-w-[280px]">
                      <div className="font-medium leading-snug">{r.description}</div>
                      {r.activityName && (
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {r.activityName}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-stone-700">{r.category ?? "—"}</td>
                    <td className="py-2 px-3 text-center">
                      {r.severity ? (
                        <span
                          className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-full text-[9px] px-2 py-0.5 ${
                            SEVERITY_PILL[r.severity] ?? "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {r.severity.toLowerCase()}
                        </span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-stone-700">{r.contractorName ?? "—"}</td>
                    <td className="py-2 px-3 text-stone-700">{r.location}</td>
                    <td className="py-2 px-3">
                      <PhotoStrip photos={r.photos} />
                    </td>
                    <td className="py-2 px-3">
                      {canManage ? (
                        <select
                          value={
                            assignableUsers.find((u) => u.name === r.assignedToName)?.id ?? ""
                          }
                          onChange={(e) => assignSnag(r.id, e.target.value)}
                          className="text-xs rounded-md border border-stone-200 px-1.5 py-0.5 bg-white"
                        >
                          <option value="">Unassigned</option>
                          {assignableUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-stone-700">{r.assignedToName ?? "—"}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-full text-[9px] px-2 py-0.5 ${
                          STATUS_PILL[r.status] ?? "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {r.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-stone-700 whitespace-nowrap">
                      {fmt(r.createdAt)}
                    </td>
                    {canManage && (
                      <td className="py-2 px-3">
                        {r.status === "OPEN" ? (
                          <button
                            type="button"
                            onClick={() => resolveSnag(r.id)}
                            className="text-xs font-medium text-stone-700 hover:text-stone-900 underline-offset-2 hover:underline"
                          >
                            Resolve
                          </button>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-stone-400 text-right">
        Showing {filtered.length} of {rows.length} snags.
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" }) {
  return (
    <th
      className={`text-[10px] uppercase tracking-wider font-medium py-2 px-3 ${
        align === "left" ? "text-left" : "text-center"
      }`}
    >
      {children}
    </th>
  );
}
