"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDayMonthYear } from "@/lib/dates";
import {
  WORK_PERMIT_STATUS_LABELS,
  WORK_PERMIT_TYPE_LABELS,
  parseApproverIds,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";
import { useToast } from "./Toast";

type WorkPermit = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  workDate: string; // ISO
  startTime: string;
  endTime: string;
  location: string | null;
  approverIds: string; // JSON
  status: WorkPermitStatus;
  updatedAt: string; // ISO — echoed on PATCH for optimistic-lock
  rejectionReason: string | null;
  requester: { id: string; name: string; username: string };
  approver: { id: string; name: string; username: string } | null;
  closer: { id: string; name: string; username: string } | null;
  contractor: { id: string; name: string } | null;
  wbsNode: { id: string; name: string; taskCode: string } | null;
  photos: { id: string; url: string }[];
};

type TabKey = "approvals" | "requests" | "all";

const STATUS_STYLES: Record<WorkPermitStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-stone-200 text-stone-700 border-stone-300",
};

export default function WorkPermitList({
  projectId,
  currentUserId,
  isFullAccess,
}: {
  projectId: string;
  currentUserId: string;
  isFullAccess: boolean;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("approvals");
  const [permits, setPermits] = useState<WorkPermit[] | null>(null);
  const [counts, setCounts] = useState<Record<WorkPermitStatus, number>>({
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    CLOSED: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = new URL(`/api/work-permits`, window.location.origin);
    url.searchParams.set("projectId", projectId);
    if (tab === "approvals") {
      url.searchParams.set("mine", "approver");
      url.searchParams.set("status", "PENDING");
    } else if (tab === "requests") {
      url.searchParams.set("mine", "requester");
    }
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        setPermits([]);
        return;
      }
      const data = await res.json();
      setPermits(data.workPermits ?? []);
      setCounts(data.counts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, CLOSED: 0 });
    } catch {
      setPermits([]);
    }
  }, [projectId, tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function transition(permit: WorkPermit, next: WorkPermitStatus, reason?: string) {
    const res = await fetch(`/api/work-permits/${permit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: next,
        rejectionReason: reason,
        expectedUpdatedAt: permit.updatedAt,
      }),
    });
    if (res.status === 409) {
      toast.warning("Someone else acted on this permit. Refreshing.");
      load();
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? `Failed (${res.status})`);
      return;
    }
    const label =
      next === "APPROVED"
        ? "Permit approved."
        : next === "REJECTED"
          ? "Permit rejected."
          : "Permit closed.";
    toast.success(label);
    setExpandedId(null);
    load();
  }

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-2">
        <TabButton
          active={tab === "approvals"}
          onClick={() => setTab("approvals")}
          label="My approvals"
          badge={tab === "approvals" && permits ? permits.length : undefined}
        />
        <TabButton
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          label="My requests"
        />
        <TabButton active={tab === "all"} onClick={() => setTab("all")} label="All" />
      </div>

      {/* Status counts strip on the "All" tab */}
      {tab === "all" && (
        <div className="flex gap-2 flex-wrap text-[10px]">
          {(["PENDING", "APPROVED", "REJECTED", "CLOSED"] as WorkPermitStatus[]).map((s) => (
            <span
              key={s}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${STATUS_STYLES[s]}`}
            >
              {counts[s]} {WORK_PERMIT_STATUS_LABELS[s].toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {/* List */}
      {permits === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : permits.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center">
          <p className="text-sm text-stone-500">
            {tab === "approvals"
              ? "No permits waiting for your approval."
              : tab === "requests"
                ? "You haven't raised any permits yet."
                : "No work permits yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {permits.map((p) => (
            <PermitRow
              key={p.id}
              permit={p}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              currentUserId={currentUserId}
              isFullAccess={isFullAccess}
              onTransition={transition}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full ${
        active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          className={`ml-1 rounded-full text-[10px] px-1.5 py-0.5 ${
            active ? "bg-white text-stone-900" : "bg-stone-900 text-white"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function PermitRow({
  permit,
  expanded,
  onToggle,
  currentUserId,
  isFullAccess,
  onTransition,
}: {
  permit: WorkPermit;
  expanded: boolean;
  onToggle: () => void;
  currentUserId: string;
  isFullAccess: boolean;
  onTransition: (p: WorkPermit, next: WorkPermitStatus, reason?: string) => void;
}) {
  const isApproverForThis = parseApproverIds(permit.approverIds).includes(currentUserId);
  const canApproveNow =
    permit.status === "PENDING" && (isApproverForThis || isFullAccess);
  const canCloseNow =
    permit.status === "APPROVED" &&
    (permit.approver?.id === currentUserId ||
      permit.requester.id === currentUserId ||
      isApproverForThis ||
      isFullAccess);

  const [rejectDraft, setRejectDraft] = useState("");
  const [showReject, setShowReject] = useState(false);

  return (
    <li className="rounded-lg border border-stone-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 flex items-start justify-between gap-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[permit.status]}`}
            >
              {WORK_PERMIT_STATUS_LABELS[permit.status]}
            </span>
            <span className="text-[10px] text-stone-500">
              {WORK_PERMIT_TYPE_LABELS[permit.type as WorkPermitType] ?? permit.type}
            </span>
          </div>
          <p className="text-sm font-medium text-stone-900 mt-1">{permit.title}</p>
          <p className="text-[10px] text-stone-500 mt-0.5">
            {formatDayMonthYear(permit.workDate)} · {permit.startTime}–{permit.endTime}
            {permit.location && <> · {permit.location}</>}
          </p>
          <p className="text-[10px] text-stone-500 mt-0.5">
            raised by {permit.requester.name}
            {permit.approver && <> · approved by {permit.approver.name}</>}
            {permit.closer && <> · closed by {permit.closer.name}</>}
          </p>
        </div>
        <span className="text-stone-400 text-sm">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-stone-100 pt-3">
          {permit.description && (
            <p className="text-xs text-stone-700 whitespace-pre-wrap">{permit.description}</p>
          )}
          {permit.contractor && (
            <p className="text-[11px] text-stone-500">Contractor: {permit.contractor.name}</p>
          )}
          {permit.wbsNode && (
            <p className="text-[11px] text-stone-500">
              Activity: {permit.wbsNode.taskCode} · {permit.wbsNode.name}
            </p>
          )}
          {permit.rejectionReason && (
            <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
              Rejected: {permit.rejectionReason}
            </p>
          )}
          {permit.photos.length > 0 && (
            <div className="grid grid-cols-4 gap-1">
              {permit.photos.map((ph) => (
                <a
                  key={ph.id}
                  href={ph.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square rounded overflow-hidden bg-stone-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt="" className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          )}

          {/* Action buttons — only show what the current user can actually do */}
          <div className="flex flex-col gap-2 pt-1">
            {canApproveNow && !showReject && (
              <>
                <button
                  type="button"
                  onClick={() => onTransition(permit, "APPROVED")}
                  className="w-full rounded-lg bg-emerald-600 text-white text-sm font-medium py-2.5 hover:bg-emerald-700"
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject(true)}
                  className="w-full rounded-lg border border-red-300 text-red-700 text-sm font-medium py-2.5 hover:bg-red-50"
                >
                  ✕ Reject
                </button>
              </>
            )}
            {canApproveNow && showReject && (
              <>
                <input
                  type="text"
                  value={rejectDraft}
                  onChange={(e) => setRejectDraft(e.target.value)}
                  placeholder="Reason for rejection (required)"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                  maxLength={1000}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReject(false)}
                    className="flex-1 rounded-lg border border-stone-300 text-stone-700 text-sm font-medium py-2.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!rejectDraft.trim()}
                    onClick={() => onTransition(permit, "REJECTED", rejectDraft.trim())}
                    className="flex-1 rounded-lg bg-red-600 text-white text-sm font-medium py-2.5 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
            {canCloseNow && (
              <button
                type="button"
                onClick={() => onTransition(permit, "CLOSED")}
                className="w-full rounded-lg border border-stone-300 text-stone-700 text-sm font-medium py-2.5 hover:bg-stone-50"
              >
                Close permit
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
