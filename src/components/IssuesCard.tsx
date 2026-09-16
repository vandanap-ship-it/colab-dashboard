"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, UserPlus, X, RotateCcw, Send } from "lucide-react";
import PhotoStrip from "./PhotoStrip";
import EmptyAllClear from "./EmptyAllClear";

type User = { id: string; name: string; username: string };

type Issue = {
  id: string;
  description: string;
  severity: string | null;
  status: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
  wbsNode: { id: string; name: string; taskCode: string } | null;
  photos: { id: string; url: string }[];
};

const SEV_STYLES: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 ring-red-200",
  MEDIUM: "bg-amber-50 text-amber-800 ring-amber-200",
  LOW: "bg-stone-50 text-stone-700 ring-stone-200",
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function IssuesCard({
  projectId,
  canResolve,
  currentUserId,
}: {
  projectId: string;
  canResolve: boolean;
  /** ID of the currently signed-in user. Used to decide whether they can flip
   *  a snag from OPEN to IN_REINSPECTION (only the assignee can — the contractor
   *  who owns the rectification). Pass null if unknown; the request button
   *  won't render. */
  currentUserId?: string | null;
}) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [users, setUsers] = useState<User[] | null>(null);
  const [openAssign, setOpenAssign] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Fetch everything (no server-side status filter) so both OPEN AND
    // IN_REINSPECTION land in the default view — they're both "still to
    // close". Filter RESOLVED out client-side unless the "Include resolved"
    // toggle is on.
    const url = `/api/issues?projectId=${projectId}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const all: Issue[] = res.ok ? (await res.json()).issues ?? [] : [];
      setIssues(showResolved ? all : all.filter((i) => i.status !== "RESOLVED"));
    } catch {
      setIssues([]);
    }
  }, [projectId, showResolved]);

  useEffect(() => {
    load();
  }, [load]);

  // Load users lazily — first time the assign menu is opened.
  useEffect(() => {
    if (openAssign && users === null) {
      fetch("/api/users", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setUsers(d.users));
    }
  }, [openAssign, users]);

  async function patchStatus(issueId: string, status: "OPEN" | "IN_REINSPECTION" | "RESOLVED") {
    const res = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load();
  }
  const resolve = (i: Issue) => patchStatus(i.id, "RESOLVED");
  const requestReinspection = (i: Issue) => patchStatus(i.id, "IN_REINSPECTION");
  const rejectRectification = (i: Issue) => patchStatus(i.id, "OPEN");

  async function assign(issueId: string, userId: string | null) {
    const res = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: userId }),
    });
    if (res.ok) {
      setOpenAssign(null);
      load();
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
          Snags &amp; Defects
        </h2>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Include resolved
        </label>
      </div>
      {issues === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : issues.length === 0 ? (
        <EmptyAllClear
          title="No open snags"
          detail={showResolved ? "Nothing on record." : "Quality inspections that fail create snags here."}
        />
      ) : (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.id} className="rounded-lg border border-stone-200 bg-ivory p-3 relative">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {i.severity && (
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ${
                          SEV_STYLES[i.severity] ?? ""
                        }`}
                      >
                        {i.severity}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ${
                        i.status === "OPEN"
                          ? "bg-red-50 text-red-700 ring-red-200"
                          : i.status === "IN_REINSPECTION"
                          ? "bg-sky-50 text-sky-700 ring-sky-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      }`}
                    >
                      {i.status === "IN_REINSPECTION" ? "IN RE-INSPECTION" : i.status}
                    </span>
                    {i.assignedTo && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-stone-700 bg-white border border-stone-200 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                        {i.assignedTo.name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-stone-900 mt-1.5">{i.description}</p>
                  <p className="text-[10px] text-stone-500 mt-1">
                    {fmt(i.createdAt)} · raised by {i.createdBy.name}
                    {i.wbsNode && <> · {i.wbsNode.name}</>}
                  </p>
                  {i.photos.length > 0 && (
                    <div className="mt-2">
                      <PhotoStrip
                        photos={i.photos.map((ph) => ({
                          ...ph,
                          meta: {
                            kind: "snag",
                            activity: i.wbsNode?.name ?? i.description?.slice(0, 60),
                            date: i.createdAt,
                          },
                        }))}
                        size="md"
                        maxInline={6}
                      />
                    </div>
                  )}
                </div>
                {/* Buttons row — depends on role AND status.
                    · OPEN + reviewer:     Assign + Resolve (direct close)
                    · OPEN + assignee:     "Request re-inspection" (contractor
                                            hands back after rectifying)
                    · IN_REINSPECTION + reviewer: Cleared + Reject rectification
                */}
                {canResolve && i.status === "OPEN" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        setOpenAssign(openAssign === i.id ? null : i.id)
                      }
                      className="inline-flex items-center gap-1 text-xs rounded-lg border border-stone-200 bg-white px-2.5 py-1 hover:bg-stone-50 hover:border-stone-300 text-stone-700 hover:text-stone-900 transition-colors"
                      title={i.assignedTo ? "Reassign" : "Assign"}
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {i.assignedTo ? "Reassign" : "Assign"}
                    </button>
                    <button
                      onClick={() => resolve(i)}
                      className="inline-flex items-center gap-1 text-xs rounded-lg bg-stone-900 text-white px-2.5 py-1 hover:bg-stone-800 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Resolve
                    </button>
                  </div>
                )}

                {/* Contractor hand-off — only the assignee themselves can
                    flip an OPEN snag into re-inspection. Hidden for reviewers
                    to keep the button surface uncluttered. */}
                {!canResolve && i.status === "OPEN" && currentUserId && i.assignedTo?.id === currentUserId && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => requestReinspection(i)}
                      className="inline-flex items-center gap-1 text-xs rounded-lg bg-sky-600 text-white px-2.5 py-1 hover:bg-sky-700 transition-colors"
                      title="Mark rectified — request re-inspection"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Request re-inspection
                    </button>
                  </div>
                )}

                {/* Inspector re-inspection resolution — after the contractor
                    marked it fixed, the inspector goes to check and either
                    closes it as Cleared or bounces it back to OPEN with a
                    note. */}
                {canResolve && i.status === "IN_REINSPECTION" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => rejectRectification(i)}
                      className="inline-flex items-center gap-1 text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1 hover:bg-stone-50 text-stone-700 transition-colors"
                      title="Rectification isn't good enough — send back to open"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reject rectification
                    </button>
                    <button
                      onClick={() => resolve(i)}
                      className="inline-flex items-center gap-1 text-xs rounded-lg bg-emerald-600 text-white px-2.5 py-1 hover:bg-emerald-700 transition-colors"
                      title="Close the snag — rectified and cleared"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Cleared
                    </button>
                  </div>
                )}
              </div>

              {openAssign === i.id && (
                <div className="mt-3 pt-3 border-t border-stone-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] uppercase tracking-widest text-stone-500">
                      Assign to
                    </p>
                    <button
                      onClick={() => setOpenAssign(null)}
                      className="text-stone-400 hover:text-stone-700"
                      aria-label="Close"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {users === null ? (
                    <p className="text-xs text-stone-500">Loading users…</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {i.assignedTo && (
                        <button
                          onClick={() => assign(i.id, null)}
                          className="text-xs rounded-full border border-stone-200 bg-white px-2.5 py-1 text-stone-500 hover:bg-stone-50"
                        >
                          Unassign
                        </button>
                      )}
                      {users.map((u) => {
                        const active = i.assignedTo?.id === u.id;
                        return (
                          <button
                            key={u.id}
                            onClick={() => assign(i.id, u.id)}
                            className={
                              "text-xs rounded-full px-2.5 py-1 transition-colors " +
                              (active
                                ? "bg-brand-400 text-stone-900"
                                : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50")
                            }
                          >
                            {u.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
