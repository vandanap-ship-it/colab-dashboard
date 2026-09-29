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
  wbsNode: { id: string; name: string; taskCode: string } | null;
  approvers?: Array<{
    id: string;
    levelIndex: number;
    canClose: boolean;
    canSuspend: boolean;
    user: { id: string; name: string; username: string };
  }>;
};

type TabKey = "active" | "future" | "closed" | "suspended" | "rejected";

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "future", label: "Future" },
  { key: "closed", label: "Closed" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
];

function startOfLocalDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucket(p: WorkPermit): TabKey {
  if (p.status === "CLOSED") return "closed";
  if (p.status === "SUSPENDED") return "suspended";
  if (p.status === "REJECTED") return "rejected";
  const workStart = startOfLocalDay(p.workDate);
  if (p.status === "APPROVED" && workStart > todayStart()) return "future";
  return "active";
}

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

  const load = useCallback(async () => {
    const url = new URL(`/api/work-permits`, window.location.origin);
    url.searchParams.set("projectId", projectId);
    // Fetch every non-deleted permit and bucket client-side. The counts
    // strip depends on all buckets being visible at once, and the site
    // team volume is small enough that filter-in-JS is fine.
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        setPermits([]);
        return;
      }
      const data = await res.json();
      setPermits(data.workPermits ?? []);
    } catch {
      setPermits([]);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

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

  const rows = useMemo(() => (permits ?? []).filter((p) => bucket(p) === tab), [permits, tab]);

  return (
    <div className="space-y-3">
      {/* Horizontal scrollable tabs — 5 buckets, Colab-parity labels. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto no-scrollbar px-1 pb-1">
        {TAB_ORDER.map((t) => (
          <TabPill
            key={t.key}
            active={tab === t.key}
            label={t.label}
            count={counts[t.key]}
            onClick={() => setTab(t.key)}
          />
        ))}
      </div>

      {permits === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white/60 p-8 text-center">
          <p className="text-sm text-stone-500">No {tab} permits.</p>
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
