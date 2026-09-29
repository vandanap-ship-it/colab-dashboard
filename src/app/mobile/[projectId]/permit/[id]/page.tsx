import { notFound, redirect } from "next/navigation";
import {
  User as UserIcon,
  Camera,
  Calendar,
  MapPin,
  Clock,
  Flame,
  Users,
  HardHat,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { permitAgeFor } from "@/lib/queueAge";
import {
  WORK_PERMIT_TYPE_LABELS,
  parseApproverIds,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";
import MobilePermitActions from "@/components/mobile/MobilePermitActions";
import MobilePermitCheckpointReviewer from "@/components/mobile/MobilePermitCheckpointReviewer";

export const dynamic = "force-dynamic";

// Colab-parity shape for a single stored checklist response. Kept as
// `unknown` in Prisma (JSON), narrowed here at read time. `reviewerNote`
// and `reviewerPhotoUrl` are the Colab-parity per-checkpoint "Add Reply"
// fields written via PATCH /api/work-permits/[id]/checkpoints.
type StoredChecklistResponse = {
  q: string;
  passed: boolean | null;
  remark?: string;
  photoUrl?: string;
  reviewerNote?: string | null;
  reviewerPhotoUrl?: string | null;
};

function narrowChecklist(v: unknown): StoredChecklistResponse[] {
  if (!Array.isArray(v)) return [];
  const out: StoredChecklistResponse[] = [];
  for (const row of v) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).q === "string") {
      const r = row as Record<string, unknown>;
      out.push({
        q: r.q as string,
        passed: typeof r.passed === "boolean" ? (r.passed as boolean) : null,
        remark: typeof r.remark === "string" ? (r.remark as string) : undefined,
        photoUrl: typeof r.photoUrl === "string" ? (r.photoUrl as string) : undefined,
        reviewerNote:
          typeof r.reviewerNote === "string" ? (r.reviewerNote as string) : null,
        reviewerPhotoUrl:
          typeof r.reviewerPhotoUrl === "string" ? (r.reviewerPhotoUrl as string) : null,
      });
    }
  }
  return out;
}

/**
 * Mobile Work Permit detail. Colab-parity layout:
 *   Header hero        · status pill + type + displayId
 *   Description
 *   When and where     · Work date, hours, location, activity
 *   People             · Requester, contractor, co-requesters, activityHead
 *   Labour             · workers/roles/counts multi-row
 *   Checklist          · per-checkpoint answers with remarks + photos
 *   Approvers          · per-level list with capability chips, decision
 *                        state, timestamps
 *   Rejection reason   · if REJECTED
 *   Photos
 *   Sticky action bar  · adapts to viewer's role + permit state
 */
export default async function MobilePermitDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${projectId}`);
  }

  const permit = await prisma.workPermit.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      requester: { select: { id: true, name: true, username: true } },
      approver: { select: { id: true, name: true } },
      closer: { select: { id: true, name: true } },
      contractor: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
      approvers: {
        orderBy: [{ levelIndex: "asc" }, { orderIndex: "asc" }],
        include: { user: { select: { id: true, name: true, username: true } } },
      },
      labourEntries: { orderBy: { orderIndex: "asc" } },
    },
  });
  if (!permit) notFound();

  const iAmRequester = permit.requesterId === session.user.id;
  const approverIds = parseApproverIds(permit.approverIds);
  const iAmApprover = approverIds.includes(session.user.id);
  // Colab-parity: Suspend is only shown to approvers whose PermitApprover
  // row carries canSuspend=true. Falls back to false when the row is
  // missing (legacy permit raised before the child-table migration).
  const iCanSuspend = permit.approvers.some(
    (a) => a.user.id === session.user.id && a.canSuspend,
  );
  const showBar =
    (iAmApprover &&
      (permit.status === "PENDING" ||
        permit.status === "APPROVED" ||
        permit.status === "SUSPENDED")) ||
    (iAmRequester && (permit.status === "APPROVED" || permit.status === "SUSPENDED"));

  const displayId =
    permit.displayId ?? `PER-${permit.id.slice(-6).toUpperCase()}`;

  // Resolve co-requester User rows in one query; falls back to just the id
  // as a chip when a user was later deactivated.
  const coRequesters =
    permit.coRequesterIds && permit.coRequesterIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: permit.coRequesterIds } },
          select: { id: true, name: true, username: true },
        })
      : [];

  const checklistRows = narrowChecklist(permit.checklistResponses);

  // Group approvers by level so the section reads as Colab does — "Level
  // 1 (Level 1)", then a row per approver at that level.
  const approversByLevel = new Map<number, typeof permit.approvers>();
  for (const a of permit.approvers) {
    const arr = approversByLevel.get(a.levelIndex) ?? [];
    arr.push(a);
    approversByLevel.set(a.levelIndex, arr);
  }
  const sortedLevels = Array.from(approversByLevel.keys()).sort((x, y) => x - y);

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold uppercase tracking-[0.14em]">
          <StatusPill status={permit.status} />
          {permit.status === "PENDING" && <DetailPermitAgingChip createdAt={permit.createdAt} />}
          <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold text-[9.5px]">
            {WORK_PERMIT_TYPE_LABELS[permit.type as WorkPermitType] ?? permit.type}
          </span>
          <span className="rounded-full bg-white/60 border border-stone-200 text-stone-600 px-2 py-0.5 font-semibold text-[9.5px] tabular-nums">
            {displayId}
          </span>
        </div>
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {permit.title}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Colab-parity "WORK DETAILS" accordion (Abhishek zip · permit
            detail collapsible group). Wraps date/time/location/activity
            AND the description in one expandable card so the reviewer
            can jump straight to the checklist without scrolling past a
            long description. Open by default; native <details> — no
            client JS. */}
        <details
          className="group rounded-xl border border-stone-200 bg-white overflow-hidden"
          open
        >
          <summary className="cursor-pointer select-none px-3 py-2.5 text-[10px] font-semibold text-stone-500 uppercase tracking-widest flex items-center justify-between hover:bg-sandstone-50/60">
            <span>Work details</span>
            <span className="text-stone-300 text-xs group-open:rotate-180 transition-transform">▾</span>
          </summary>

          <div className="px-3 pb-3 space-y-2 text-sm border-t border-stone-100 pt-3">
            <div className="flex items-center gap-2 text-stone-700">
              <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Work date</span>
              <span className="font-medium">{fmtDate(permit.workDate)}</span>
            </div>
            <div className="flex items-center gap-2 text-stone-700">
              <Clock className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Hours</span>
              <span className="font-medium">{permit.startTime} – {permit.endTime}</span>
            </div>
            {permit.location && (
              <div className="flex items-start gap-2 text-stone-700">
                <MapPin className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">
                  Exact location
                </span>
                <span className="font-medium leading-snug">{permit.location}</span>
              </div>
            )}
            {permit.activityHead && (
              <div className="flex items-start gap-2 text-stone-700">
                <span className="w-4 h-4 shrink-0" />
                <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">
                  Activity head
                </span>
                <span className="font-medium leading-snug">{permit.activityHead}</span>
              </div>
            )}
            {permit.wbsNode && (
              <div className="flex items-start gap-2 text-stone-700">
                <span className="w-4 h-4 shrink-0" />
                <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
                <span className="font-medium leading-snug">{permit.wbsNode.name}</span>
              </div>
            )}
            {permit.description && (
              <div className="pt-2 border-t border-stone-100 mt-2">
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  Work description
                </p>
                <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">
                  {permit.description}
                </p>
              </div>
            )}
          </div>
        </details>

        {/* People */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Requested by</span>
            <span className="font-medium">{permit.requester.name}</span>
          </div>
          {permit.contractor && (
            <div className="flex items-center gap-2 text-stone-700">
              <Flame className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Contractor</span>
              <span className="font-medium">{permit.contractor.name}</span>
            </div>
          )}
          {coRequesters.length > 0 && (
            <div className="flex items-start gap-2 text-stone-700">
              <Users className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">
                Co-requesters
              </span>
              <span className="font-medium leading-snug flex flex-wrap gap-1">
                {coRequesters.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center rounded-full bg-sandstone-50 border border-sandstone-100 text-[11px] px-2 py-0.5"
                  >
                    {u.name}
                  </span>
                ))}
              </span>
            </div>
          )}
          {permit.approver && permit.approvedAt && (
            <div className="flex items-center gap-2 text-emerald-800 pt-2 border-t border-stone-100 mt-2">
              <UserIcon className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-emerald-700/70 text-xs uppercase tracking-wider mr-1">Approved by</span>
              <span className="font-medium">{permit.approver.name}</span>
              <span className="text-xs text-emerald-700/70 ml-auto">{fmtDate(permit.approvedAt)}</span>
            </div>
          )}
          {permit.closer && permit.closedAt && (
            <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
              <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Closed by</span>
              <span className="font-medium">{permit.closer.name}</span>
              <span className="text-xs text-stone-400 ml-auto">{fmtDate(permit.closedAt)}</span>
            </div>
          )}
        </section>

        {/* Labour Entries — Colab shows this even for General Work when
            the requester listed workers on Step 2. */}
        {permit.labourEntries.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              <HardHat className="w-3 h-3" />
              Labour · {permit.labourEntries.length}
            </div>
            <ul className="divide-y divide-stone-100">
              {permit.labourEntries.map((l) => (
                <li key={l.id} className="py-1.5 flex items-center gap-2 text-sm">
                  <span className="font-medium text-ink flex-1 truncate">
                    {l.workerName ?? "—"}
                  </span>
                  <span className="text-stone-500 text-xs truncate">{l.role ?? ""}</span>
                  <span className="tabular-nums text-stone-700 font-semibold text-xs">
                    {l.count != null ? `× ${l.count}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Checklist responses — the Step-3 answers, rendered read-only.
            Passed = green ✓, Failed = red ✗, unanswered = grey dash. */}
        {checklistRows.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              <ClipboardList className="w-3 h-3" />
              Checklist · {checklistRows.length}
            </div>
            <ol className="space-y-2">
              {checklistRows.map((row, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm border-b border-stone-100 pb-2 last:border-b-0 last:pb-0"
                >
                  <ChecklistMark passed={row.passed} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink leading-snug">
                      <span className="text-stone-500 mr-1">{i + 1}.</span>
                      {row.q}
                    </p>
                    {row.remark && (
                      <p className="text-xs text-stone-600 mt-1 bg-sandstone-50 rounded px-2 py-1 whitespace-pre-wrap">
                        {row.remark}
                      </p>
                    )}
                    {row.photoUrl && (
                      <a
                        href={row.photoUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-block mt-1 w-16 h-16 rounded overflow-hidden bg-stone-100 border border-stone-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.photoUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    {/* Colab-parity per-checkpoint reviewer controls:
                        editable only for a listed approver while the
                        permit is still PENDING. Otherwise show the
                        stored reply read-only so the audit trail is
                        visible after approve/reject/close. */}
                    {iAmApprover && permit.status === "PENDING" ? (
                      <MobilePermitCheckpointReviewer
                        permitId={permit.id}
                        index={i}
                        initialNote={row.reviewerNote ?? null}
                        initialPhotoUrl={row.reviewerPhotoUrl ?? null}
                      />
                    ) : (
                      (row.reviewerNote || row.reviewerPhotoUrl) && (
                        <div className="mt-2 space-y-1.5">
                          {row.reviewerNote && (
                            <p className="text-[12px] text-ink bg-sandstone-50 rounded-md px-2 py-1 border border-sandstone-100 whitespace-pre-wrap">
                              <span className="text-[10px] font-semibold text-ferrous-600 uppercase tracking-wider mr-1.5">
                                Approver
                              </span>
                              {row.reviewerNote}
                            </p>
                          )}
                          {row.reviewerPhotoUrl && (
                            <a
                              href={row.reviewerPhotoUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-block w-12 h-12 rounded-md overflow-hidden border border-stone-200 bg-stone-50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={row.reviewerPhotoUrl}
                                alt="Approver photo"
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </a>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Approvers — per-level breakdown, Colab-parity Screen 24. Shows
            the level pill, then a row per approver with capability chips
            (Can Close, Can Suspend) and the decision state. */}
        {sortedLevels.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              <ShieldCheck className="w-3 h-3" />
              Approvers · {permit.approvers.length}
            </div>
            <div className="space-y-3">
              {sortedLevels.map((lvl) => {
                const rows = approversByLevel.get(lvl) ?? [];
                const levelName = rows[0]?.levelName ?? `Level ${lvl}`;
                return (
                  <div key={lvl}>
                    <div className="inline-flex items-center rounded-full bg-ink text-cream text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wider">
                      Level {lvl}{levelName && levelName !== `Level ${lvl}` ? ` · ${levelName}` : ""}
                    </div>
                    <ul className="mt-2 space-y-2">
                      {rows.map((a) => {
                        const isDecided =
                          permit.approver?.id === a.user.id ||
                          permit.closer?.id === a.user.id;
                        return (
                          <li
                            key={a.id}
                            className="flex items-start gap-2 text-sm border-l-2 border-sandstone-200 pl-2"
                          >
                            <UserIcon className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink leading-snug">{a.user.name}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {a.canClose && <CapChip color="emerald" label="Can Close" />}
                                {a.canSuspend && <CapChip color="amber" label="Can Suspend" />}
                                {a.isDefault && <CapChip color="stone" label="Default" />}
                              </div>
                              {isDecided && (
                                <p className="text-[10px] uppercase tracking-wider mt-1 text-emerald-700 font-semibold">
                                  ✓ Acted
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Suspension banner — shown whenever the permit is currently
            paused OR has a paused-and-resumed history the reviewer
            should see. */}
        {(permit.status === "SUSPENDED" || permit.suspendedAt) && (
          <section className="rounded-xl border border-orange-200 bg-orange-50 p-3">
            <div className="text-[10px] font-semibold text-orange-800 uppercase tracking-wider mb-1">
              {permit.status === "SUSPENDED" ? "Currently suspended" : "Was suspended"}
            </div>
            {permit.suspendedReason && (
              <p className="text-sm text-orange-900 leading-snug">{permit.suspendedReason}</p>
            )}
            {permit.suspendedAt && (
              <p className="text-[11px] text-orange-800 mt-1">
                Paused {fmtDate(permit.suspendedAt)}
                {permit.suspensionResolvedAt && (
                  <> · resumed {fmtDate(permit.suspensionResolvedAt)}</>
                )}
              </p>
            )}
          </section>
        )}

        {/* Rejection reason */}
        {permit.status === "REJECTED" && permit.rejectionReason && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-[10px] font-semibold text-red-800 uppercase tracking-wider mb-1">
              Why rejected
            </div>
            <p className="text-sm text-red-900 leading-snug">{permit.rejectionReason}</p>
          </section>
        )}

        {permit.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {permit.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {permit.photos.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200 block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      {showBar && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          <MobilePermitActions
            permitId={permit.id}
            currentStatus={permit.status as WorkPermitStatus}
            expectedUpdatedAt={permit.updatedAt.toISOString()}
            projectId={projectId}
            iAmApprover={iAmApprover}
            iAmRequester={iAmRequester}
            iCanSuspend={iCanSuspend}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Awaiting approval" },
    APPROVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Approved" },
    SUSPENDED: { bg: "bg-orange-50 ring-orange-200", fg: "text-orange-800", label: "Suspended" },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected" },
    CLOSED: { bg: "bg-stone-100 ring-stone-200", fg: "text-stone-700", label: "Closed" },
  };
  const cfg = map[status] ?? map.PENDING;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function ChecklistMark({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (passed === false) {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-xs font-bold shrink-0">
        ✕
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-100 text-stone-400 text-xs font-bold shrink-0">
      —
    </span>
  );
}

function CapChip({
  color,
  label,
}: {
  color: "emerald" | "amber" | "stone";
  label: string;
}) {
  const map: Record<typeof color, string> = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    stone: "bg-stone-100 text-stone-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full text-[10px] font-semibold px-1.5 py-0.5 ${map[color]}`}
    >
      {label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Aging chip on the detail hero. Colour palette matches the amber /
 * red status semantic that permits already use (a stale permit reads
 * as an escalating warning), so the two chips beside each other feel
 * like one signal rather than competing ones.
 */
function DetailPermitAgingChip({ createdAt }: { createdAt: Date }) {
  const age = permitAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-red-50 ring-red-200 text-red-800"
      : "bg-amber-50 ring-amber-200 text-amber-800";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums normal-case tracking-normal ${cls}`}
      title={`Raised ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}
