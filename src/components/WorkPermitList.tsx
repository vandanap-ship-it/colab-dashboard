"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDayMonthYear } from "@/lib/dates";
import {
  WORK_PERMIT_TYPE_LABELS,
  parseApproverIds,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";
import {
  bucketPermit,
  sortDirectionForTab,
  startOfLocalDay,
  PERMIT_TAB_ORDER as TAB_ORDER,
  type PermitTabKey as TabKey,
} from "@/lib/permitBuckets";

/**
 * Colab-parity permit list (Abhishek + Girish zips, screens 3-9).
 *
 * The site team's mental model is "which permits are running / next /
 * done / paused / rejected" — not our internal state machine. So we
 * pivot the raw status counts into 5 tabs:
 *
 *   Active     PENDING (all) + APPROVED with workDate <= today
 *              (the crew is either waiting on sign-off or on site now).
 *   Future     APPROVED with workDate > today.
 *   Closed     CLOSED.
 *   Suspended  SUSPENDED.
 *   Rejected   REJECTED.
 *
 * Each card mirrors Colab's own card: LEFT dark ink title strip + RIGHT
 * light-gray KV grid + full-width Approval Progress bar at the bottom.
 */

type WorkPermit = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  workDate: string; // ISO
  startTime: string;
  endTime: string;
  location: string | null;
  approverIds: string; // JSON string array
  status: WorkPermitStatus;
  createdAt: string;
  updatedAt: string;
  displayId: string | null;
  activityHead: string | null;
  rejectionReason: string | null;
  requester: { id: string; name: string; username: string };
  approver: { id: string; name: string; username: string } | null;
  closer: { id: string; name: string; username: string } | null;
  contractor: { id: string; name: string } | null;
  wbsNode: {
    id: string;
    name: string;
    taskCode: string;
    villaId: string | null;
    villaMilestone: {
      section: { id: string; name: string; orderIndex: number };
    } | null;
  } | null;
  approvers?: Array<{
    id: string;
    levelIndex: number;
    canClose: boolean;
    canSuspend: boolean;
    user: { id: string; name: string; username: string };
  }>;
};

const bucket = (p: WorkPermit): TabKey => bucketPermit(p);

// Colab shows a fixed progress ratio per status. We match their copy so
// site team's muscle memory carries when they switch tools.
function approvalProgress(p: WorkPermit): {
  label: string;
  pct: number;
  ringClass: string;
  fillClass: string;
  textClass: string;
} {
  switch (p.status) {
    case "PENDING":
      return {
        label: "Pending approval",
        pct: 33,
        ringClass: "ring-amber-200",
        fillClass: "bg-amber-400",
        textClass: "text-amber-800",
      };
    case "APPROVED":
      return {
        label: "Approved",
        pct: 66,
        ringClass: "ring-emerald-200",
        fillClass: "bg-emerald-500",
        textClass: "text-emerald-800",
      };
    case "SUSPENDED":
      return {
        label: "Suspended",
        pct: 50,
        ringClass: "ring-orange-200",
        fillClass: "bg-orange-400",
        textClass: "text-orange-800",
      };
    case "REJECTED":
      return {
        label: "Rejected",
        pct: 100,
        ringClass: "ring-red-200",
        fillClass: "bg-red-400",
        textClass: "text-red-800",
      };
    case "CLOSED":
      return {
        label: "Closed",
        pct: 100,
        ringClass: "ring-stone-200",
        fillClass: "bg-stone-400",
        textClass: "text-stone-700",
      };
    default:
      return {
        label: p.status,
        pct: 0,
        ringClass: "ring-stone-200",
        fillClass: "bg-stone-300",
        textClass: "text-stone-700",
      };
  }
}

/**
 * Colab-parity chip-filter set per tab. Values stay stable (lowercase,
 * kebab-safe) so the chipFilter state can be a simple string. "all" is
 * the universal reset.
 *
 * Active / Future / Rejected  →  All | Pending | Partial | Approved
 * Closed                      →  All | Manually Closed | Auto-Closed
 * Suspended                   →  All (no sub-filter, kept for consistency)
 *
 * "Partial" is defined here as a permit still in PENDING but with at
 * least one of its multi-level approvers having signed off. Siddhi today
 * has one approver level, so Partial is always empty — the chip
 * light up once max-5-levels lands. Including it now keeps the UI
 * stable; no visible flicker when the backend grows.
 */
type ChipDef = { key: string; label: string };
function chipsForTab(tab: TabKey): ChipDef[] {
  if (tab === "closed") {
    return [
      { key: "all", label: "All" },
      { key: "manually-closed", label: "Manually Closed" },
      { key: "auto-closed", label: "Auto-Closed" },
    ];
  }
  if (tab === "suspended") {
    return [{ key: "all", label: "All" }];
  }
  return [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "partial", label: "Partial" },
    { key: "approved", label: "Approved" },
  ];
}

/** True when the permit matches the chip, within its already-bucketed tab. */
function permitMatchesChip(p: WorkPermit, chip: string): boolean {
  if (chip === "all") return true;
  if (chip === "pending") return p.status === "PENDING";
  if (chip === "approved") return p.status === "APPROVED";
  if (chip === "partial") {
    // Multi-level approval partial state. Lights up when max-levels > 1.
    if (p.status !== "PENDING") return false;
    const levels = p.approvers ?? [];
    if (levels.length <= 1) return false;
    const anySigned = levels.some((a) => a.user?.id); // placeholder — refine when per-level sign tracking lands
    return anySigned && levels.length > 1;
  }
  if (chip === "manually-closed") return p.status === "CLOSED" && p.closer != null;
  if (chip === "auto-closed") return p.status === "CLOSED" && p.closer == null;
  return true;
}

export default function WorkPermitList({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId: string;
  // isFullAccess is accepted for backward compatibility with the calling
  // page but no longer changes the default tab — Colab lands every user
  // on "Active" so the site team sees the same first screen regardless
  // of role.
  isFullAccess?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("active");
  const [permits, setPermits] = useState<WorkPermit[] | null>(null);
  // Colab-parity chip row below the tab bar. The chip set changes by
  // tab, so switching tabs resets the chip to "all" to avoid the
  // confusing "I'm on Closed but the chip says Pending so I see nothing"
  // state. See chipsForTab() for the per-tab chip list.
  const [chipFilter, setChipFilter] = useState<string>("all");
  const onSetTab = useCallback((next: TabKey) => {
    setTab(next);
    setChipFilter("all");
  }, []);
  // Colab-parity Advanced Filters (Abhishek zip · permit list · filter
  // sheet). Contractor + date range this pass; 3-level location cascade
  // is a follow-up when the permit picker component lands. Filters run
  // client-side alongside the tab bucket — the project's permit volume
  // stays small.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterContractorId, setFilterContractorId] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  // Colab-parity 3-level location cascade in the Advanced Filters
  // sheet. Villa → Section → WBS activity. Each level narrows what the
  // downstream picker lists. Shipped 2026-10-12 (Vandana).
  const [filterVillaId, setFilterVillaId] = useState<string>("");
  const [filterSectionId, setFilterSectionId] = useState<string>("");
  const [filterWbsNodeId, setFilterWbsNodeId] = useState<string>("");
  const [villas, setVillas] = useState<Array<{ id: string; number: number; label: string | null }>>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Load the project's villa list once. The endpoint auto-filters to
  // the user's contractor (if they're contractor-tagged), so this list
  // already reflects what the user can see.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/villas`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { villas: [] }))
      .then((d) => {
        if (!cancelled) setVillas(d.villas ?? []);
      })
      .catch(() => {
        if (!cancelled) setVillas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const load = useCallback(async () => {
    const url = new URL(`/api/work-permits`, window.location.origin);
    url.searchParams.set("projectId", projectId);
    setLoadError(false);
    // Fetch every non-deleted permit and bucket client-side. The counts
    // strip depends on all buckets being visible at once, and the site
    // team volume is small enough that filter-in-JS is fine.
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        setLoadError(true);
        setPermits([]);
        return;
      }
      const data = await res.json();
      setPermits(data.workPermits ?? []);
    } catch {
      setLoadError(true);
      setPermits([]);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const counts = useMemo<Record<TabKey, number>>(() => {
    const zero: Record<TabKey, number> = {
      active: 0,
      future: 0,
      closed: 0,
      suspended: 0,
      rejected: 0,
    };
    if (!permits) return zero;
    for (const p of permits) zero[bucket(p)] += 1;
    return zero;
  }, [permits]);

  // Contractor list derived from the loaded permits so the picker only
  // shows contractors that actually own a permit on this project.
  const contractorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of permits ?? []) {
      if (p.contractor) seen.set(p.contractor.id, p.contractor.name);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [permits]);

  // Section options: distinct sections across permits whose WBS node
  // belongs to the chosen villa. When no villa is picked, show every
  // section that appears on any permit. Sorted by section orderIndex
  // so Foundation → Plinth → GF Structure read in build order.
  const sectionOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; orderIndex: number }>();
    for (const p of permits ?? []) {
      const sec = p.wbsNode?.villaMilestone?.section;
      if (!sec) continue;
      if (filterVillaId && p.wbsNode?.villaId !== filterVillaId) continue;
      seen.set(sec.id, sec);
    }
    return Array.from(seen.values()).sort((a, b) => a.orderIndex - b.orderIndex);
  }, [permits, filterVillaId]);

  // Activity options: distinct WBS nodes that satisfy the chosen villa
  // AND section. If a user picks only a villa (no section), still show
  // every activity on that villa so the third picker is usable.
  const activityOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; taskCode: string }>();
    for (const p of permits ?? []) {
      const node = p.wbsNode;
      if (!node) continue;
      if (filterVillaId && node.villaId !== filterVillaId) continue;
      if (filterSectionId && node.villaMilestone?.section?.id !== filterSectionId) continue;
      seen.set(node.id, { id: node.id, name: node.name, taskCode: node.taskCode });
    }
    return Array.from(seen.values()).sort((a, b) => a.taskCode.localeCompare(b.taskCode));
  }, [permits, filterVillaId, filterSectionId]);

  // Downstream reset when upstream changes. If the user clears or
  // changes a Villa, the previously-picked Section may no longer exist
  // under it; same for Activity under Section.
  useEffect(() => {
    if (!filterVillaId) return;
    if (filterSectionId && !sectionOptions.some((s) => s.id === filterSectionId)) {
      setFilterSectionId("");
      setFilterWbsNodeId("");
    }
  }, [filterVillaId, filterSectionId, sectionOptions]);
  useEffect(() => {
    if (!filterSectionId) return;
    if (filterWbsNodeId && !activityOptions.some((a) => a.id === filterWbsNodeId)) {
      setFilterWbsNodeId("");
    }
  }, [filterSectionId, filterWbsNodeId, activityOptions]);

  const rows = useMemo(() => {
    const from = filterDateFrom ? startOfLocalDay(filterDateFrom) : -Infinity;
    const to = filterDateTo ? startOfLocalDay(filterDateTo) : Infinity;
    const filtered = (permits ?? []).filter((p) => {
      if (bucket(p) !== tab) return false;
      if (!permitMatchesChip(p, chipFilter)) return false;
      if (filterContractorId && p.contractor?.id !== filterContractorId) return false;
      if (filterVillaId && p.wbsNode?.villaId !== filterVillaId) return false;
      if (filterSectionId && p.wbsNode?.villaMilestone?.section?.id !== filterSectionId) return false;
      if (filterWbsNodeId && p.wbsNode?.id !== filterWbsNodeId) return false;
      const w = startOfLocalDay(p.workDate);
      if (w < from || w > to) return false;
      return true;
    });
    // Per-tab ordering: Future shows next-up first (workDate asc); every
    // other tab reads most-recent first (workDate desc) — a done/paused/
    // rejected permit reviewer wants the latest at the top; a scheduler
    // scanning Future wants tomorrow before next week.
    const direction = sortDirectionForTab(tab);
    return filtered.slice().sort((a, b) => {
      const diff = startOfLocalDay(a.workDate) - startOfLocalDay(b.workDate);
      if (diff !== 0) return diff * direction;
      // Tie-break by createdAt (latest first for stability).
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [
    permits,
    tab,
    chipFilter,
    filterContractorId,
    filterVillaId,
    filterSectionId,
    filterWbsNodeId,
    filterDateFrom,
    filterDateTo,
  ]);

  const activeFilterCount =
    (filterContractorId ? 1 : 0) +
    (filterVillaId ? 1 : 0) +
    (filterSectionId ? 1 : 0) +
    (filterWbsNodeId ? 1 : 0) +
    (filterDateFrom ? 1 : 0) +
    (filterDateTo ? 1 : 0);
  function clearFilters() {
    setFilterContractorId("");
    setFilterVillaId("");
    setFilterSectionId("");
    setFilterWbsNodeId("");
    setFilterDateFrom("");
    setFilterDateTo("");
  }

  return (
    <div className="space-y-3">
      {/* Horizontal scrollable tabs — 5 buckets, Colab-parity labels. */}
      <div className="flex items-center gap-2">
        <div className="-mx-1 flex-1 flex gap-1.5 overflow-x-auto no-scrollbar px-1 pb-1">
          {TAB_ORDER.map((t) => (
            <TabPill
              key={t.key}
              active={tab === t.key}
              label={t.label}
              count={counts[t.key]}
              onClick={() => onSetTab(t.key)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className={`shrink-0 rounded-full text-[12px] font-semibold px-3 py-1.5 flex items-center gap-1 ${
            activeFilterCount > 0
              ? "bg-ferrous-500 text-white"
              : "bg-white border border-stone-200 text-stone-700"
          }`}
        >
          Filter
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-white text-ferrous-600 text-[10px] px-1.5 min-w-[16px] h-[14px] inline-flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Chip sub-filter row — Colab parity. Set depends on the active tab;
          see chipsForTab(). Suspended returns a single "All" chip so the
          row keeps its height, keeps the vertical rhythm stable. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto no-scrollbar px-1">
        {chipsForTab(tab).map((c) => {
          const active = chipFilter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChipFilter(c.key)}
              className={`shrink-0 rounded-full text-[12px] font-semibold px-3 py-1 border transition-colors ${
                active
                  ? "bg-ink text-white border-ink"
                  : "bg-white text-stone-700 border-stone-200 hover:border-stone-400"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {filtersOpen && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
              Contractor
            </label>
            <select
              value={filterContractorId}
              onChange={(e) => setFilterContractorId(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All contractors</option>
              {contractorOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Colab-parity 3-level location cascade. Downstream pickers
              disable until their upstream is picked, like Colab's
              Location → Sub-location → Sub-sub-location sheet. */}
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
              Location (villa)
            </label>
            <select
              value={filterVillaId}
              onChange={(e) => {
                setFilterVillaId(e.target.value);
                setFilterSectionId("");
                setFilterWbsNodeId("");
              }}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All villas</option>
              {villas.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label ?? `Villa ${String(v.number).padStart(2, "0")}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
              Sub-location (section)
            </label>
            <select
              value={filterSectionId}
              onChange={(e) => {
                setFilterSectionId(e.target.value);
                setFilterWbsNodeId("");
              }}
              disabled={sectionOptions.length === 0}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100 disabled:text-stone-400"
            >
              <option value="">
                {filterVillaId ? "All sections on this villa" : "All sections"}
              </option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {sectionOptions.length === 0 && filterVillaId && (
              <p className="text-[11px] text-stone-400 italic mt-1">
                No permits on this villa yet.
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
              Sub-sub-location (activity)
            </label>
            <select
              value={filterWbsNodeId}
              onChange={(e) => setFilterWbsNodeId(e.target.value)}
              disabled={activityOptions.length === 0}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100 disabled:text-stone-400"
            >
              <option value="">
                {filterVillaId || filterSectionId ? "All activities in scope" : "All activities"}
              </option>
              {activityOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.taskCode} · {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                From
              </label>
              <input
                type="date"
                value={filterDateFrom}
                max={filterDateTo || undefined}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                To
              </label>
              <input
                type="date"
                value={filterDateTo}
                min={filterDateFrom || undefined}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="w-full text-[12px] font-semibold text-ferrous-600 py-1.5 hover:text-ferrous-700"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {permits === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-sm text-red-800">Couldn&apos;t load permits.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 text-sm font-semibold text-red-700 underline"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white/60 p-8 text-center">
          <p className="text-sm text-stone-500">
            No {tab} permits{activeFilterCount > 0 ? " match the current filters." : "."}
          </p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 text-[12px] font-semibold text-ferrous-600 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <PermitCard
              key={p.id}
              permit={p}
              projectId={projectId}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full text-[12px] font-semibold px-3 py-1.5 whitespace-nowrap ${
        active
          ? "bg-ink text-cream"
          : "bg-white border border-stone-200 text-stone-700"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] px-1.5 min-w-[18px] h-[16px] ${
            active ? "bg-cream text-ink" : "bg-stone-100 text-stone-600"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function PermitCard({
  permit,
  projectId,
  currentUserId,
}: {
  permit: WorkPermit;
  projectId: string;
  currentUserId: string;
}) {
  const typeLabel = WORK_PERMIT_TYPE_LABELS[permit.type as WorkPermitType] ?? permit.type;
  const isApproverForThis = parseApproverIds(permit.approverIds).includes(currentUserId);
  const progress = approvalProgress(permit);
  // Colab renders the last-6 of the id as a chip when the permit hasn't
  // been given a displayId yet. Every new permit ships with one, but
  // historical rows won't — the fallback keeps the layout consistent.
  const idChip = permit.displayId ?? `PER-${permit.id.slice(-6).toUpperCase()}`;

  return (
    <li>
      <Link
        href={`/mobile/${projectId}/permit/${permit.id}`}
        className="block rounded-xl overflow-hidden border border-stone-200 bg-white shadow-[0_1px_2px_rgba(22,25,38,0.04)]"
      >
        {/* Top strip: LEFT dark ink title panel + RIGHT id + type */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch">
          <div className="bg-ink text-cream px-3 py-2.5 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-cream/60 font-semibold">
              {typeLabel}
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug line-clamp-2">
              {permit.title}
            </p>
          </div>
          <div className="bg-sandstone-50 px-3 py-2.5 flex flex-col items-end justify-center border-l border-stone-100">
            <p className="text-[9px] uppercase tracking-widest text-stone-400 font-semibold">
              Permit ID
            </p>
            <p className="text-[11px] font-semibold tabular-nums text-ink">{idChip}</p>
            {isApproverForThis && permit.status === "PENDING" && (
              <span className="mt-1 inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5">
                Awaiting you
              </span>
            )}
            {isApproverForThis && permit.status === "SUSPENDED" && (
              <span className="mt-1 inline-flex items-center rounded-full bg-orange-100 text-orange-800 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5">
                Paused — you can resume
              </span>
            )}
          </div>
        </div>

        {/* KV grid — 2 cols, Colab-parity labels. */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 border-b border-stone-100 bg-white">
          <KV label="Work date" value={formatDayMonthYear(permit.workDate)} />
          <KV label="Time" value={`${permit.startTime}–${permit.endTime}`} />
          <KV label="Location" value={permit.location ?? "—"} />
          <KV label="Contractor" value={permit.contractor?.name ?? "—"} />
          <KV
            label="Activity"
            value={
              permit.activityHead ??
              (permit.wbsNode ? `${permit.wbsNode.taskCode} · ${permit.wbsNode.name}` : "—")
            }
          />
          <KV label="Raised by" value={permit.requester.name} />
        </div>

        {/* Approval Progress footer bar — matches Colab's "Approval
            Progress" line at the bottom of every card. */}
        <div className="px-3 py-2.5 bg-white">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">
              Approval progress
            </p>
            <p className={`text-[11px] font-semibold ${progress.textClass}`}>
              {progress.label}
            </p>
          </div>
          <div className={`w-full h-1.5 rounded-full bg-stone-100 ring-1 ${progress.ringClass}`}>
            <div
              className={`h-full rounded-full ${progress.fillClass}`}
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      </Link>
    </li>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-widest text-stone-400 font-semibold">
        {label}
      </p>
      <p className="text-[12px] text-ink truncate" title={value}>
        {value}
      </p>
    </div>
  );
}
