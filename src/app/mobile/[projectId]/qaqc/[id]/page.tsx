import { notFound, redirect } from "next/navigation";
import { CalendarClock, CheckCircle2, FileEdit, MessageSquare, X, Clock, User as UserIcon, Users as UsersIcon, Camera } from "lucide-react";
import MobileInspectionItemReviewerControls from "@/components/mobile/MobileInspectionItemReviewerControls";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { canReview, isAdmin } from "@/lib/roles";
import { wirAgeFor } from "@/lib/queueAge";
import MobileQaqcReviewActions from "@/components/mobile/MobileQaqcReviewActions";
import MobileQaqcReopenAction from "@/components/mobile/MobileQaqcReopenAction";
import MobileQaqcDraftActions from "@/components/mobile/MobileQaqcDraftActions";

export const dynamic = "force-dynamic";

/**
 * Mobile inspection detail — read the checklist the engineer filled, browse
 * photos, and (if you can review) tap Pass / Reject at the bottom without
 * having to bounce to the desktop.
 *
 * Item pass/fail state is read-only here — the engineer sets it when they
 * fill the WIR on `/mobile/[projectId]/inspection/new`. The reviewer's
 * decision is the overall inspection status, not per-item.
 */
export default async function MobileInspectionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; id: string }>;
  searchParams: Promise<{ tab?: string; module?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;
  const { tab, module: moduleParam } = await searchParams;

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    redirect(`/mobile/${projectId}`);
  }

  const inspection = await prisma.inspection.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      filledBy: { select: { id: true, name: true, username: true } },
      reviewedBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      items: { orderBy: { orderIndex: "asc" } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!inspection) notFound();

  // Hydrate the picked-reviewer names. The Inspection model stores their
  // ids on assignedReviewerIds (postgres text[]); the detail card needs
  // their names. Skips the lookup entirely when nothing was picked, so
  // the pre-Sep-2026 WIRs cost zero extra queries.
  const assignedReviewers = inspection.assignedReviewerIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: inspection.assignedReviewerIds } },
        select: { id: true, name: true, username: true, role: true },
      })
    : [];

  // Module gate — a QAQC-scoped user cannot open a SAFETY inspection and vice
  // versa. Server-side belt matches the API's own belt-and-braces.
  if (!canAccessScopedRow(session.user.modules, inspection.module)) {
    redirect(`/mobile/${projectId}/qaqc`);
  }

  // Draft privacy gate — a DRAFT WIR is a private in-progress checklist
  // that only the filler themselves (and admins) may open. Anyone else
  // (a reviewer trying to peek, a hand-crafted URL) bounces back to the
  // list. Same shape as the module gate above so both invariants are
  // enforced in one spot at page-load.
  if (
    inspection.status === "DRAFT" &&
    inspection.filledBy.id !== session.user.id &&
    !isAdmin(session.user.role)
  ) {
    redirect(`/mobile/${projectId}/qaqc`);
  }

  const iCanReview = canReview(session.user.role);
  const iAmTheFiller = inspection.filledBy.id === session.user.id;
  // The layout's single Back arrow uses router.back(), which already
  // lands on whichever list view the engineer came from (no extra
  // plumbing needed for the *header* back).
  void tab;
  // Module context IS still needed for the Pass/Reject redirect below —
  // the review action performs a router.push after PATCH and needs to
  // land on the same module-filtered pending list (EHS reviewer → EHS
  // Pending, QA/QC reviewer → QA/QC Pending), not the combined feed.
  const reviewModuleFilter: "QAQC" | "SAFETY" | undefined =
    moduleParam === "QAQC" || moduleParam === "SAFETY" ? moduleParam : undefined;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Hero band matches every other mobile screen — Fraunces title,
          sandstone gradient, no inline back button (the layout's header
          Back arrow is the single source of "return" and uses
          router.back() so it lands on the previous page, not home). */}
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        {/* Colab-parity title on the reviewer side: "Approval Checklist"
            while the WIR is pending review (matches Colab screenshot 15,
            where Thangamani's opened WIR is titled "Approval Checklist"
            with the template name in a summary card below). Reviewed
            WIRs (PASSED/REJECTED) show the template title as before. */}
        <h1 className="font-serif text-[22px] leading-snug text-ink tracking-tight">
          {inspection.status === "IN_REVIEW" ? "Approval Checklist" : inspection.title}
        </h1>
        {inspection.status === "IN_REVIEW" && (
          <p className="mt-1 text-sm font-semibold text-ink-2">{inspection.title}</p>
        )}

        <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px] text-ink-3">
          <StatusPill status={inspection.status} />
          {/* Same age chip the list card shows, so the two surfaces
              read the same number from the same math. */}
          {inspection.status === "IN_REVIEW" && <DetailAgingChip createdAt={inspection.createdAt} />}
          {inspection.module && (
            <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold uppercase tracking-[0.14em] text-[9.5px]">
              {inspection.module === "SAFETY" ? "EHS" : "QA/QC"}
            </span>
          )}
          <span>·</span>
          <span>Filled {fmtDate(inspection.createdAt)}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Who / Where */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Filled by</span>
            <span className="font-medium">{inspection.filledBy.name}</span>
          </div>
          {inspection.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{inspection.wbsNode.name}</span>
            </div>
          )}
          {/* Colab-parity: Trigger Type on the summary card (screen 15
              of Thangamani zip). Manual for filler-initiated WIRs;
              Auto reserved for scheduled or hook-spawned WIRs. */}
          <div className="flex items-center gap-2 text-stone-700">
            <span className="w-4 h-4 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Trigger Type</span>
            <span className="font-medium">{inspection.triggerType ?? "Manual"}</span>
          </div>
          {inspection.reviewedBy && inspection.reviewedAt && (
            <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
              <CheckCircle2 className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Reviewed by</span>
              <span className="font-medium">{inspection.reviewedBy.name}</span>
              <span className="text-xs text-stone-400 ml-auto">{fmtDate(inspection.reviewedAt)}</span>
            </div>
          )}
        </section>

        {/* Rejection reason */}
        {inspection.status === "REJECTED" && inspection.rejectionReason && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-[10px] font-semibold text-red-800 uppercase tracking-wider mb-1">Why rejected</div>
            <p className="text-sm text-red-900 leading-snug">{inspection.rejectionReason}</p>
          </section>
        )}

        {/* Reschedule callout · answers "when does this reopen and why".
            Only rendered when the WIR is currently parked; a WIR that
            was rescheduled and then reviewed keeps the historical
            rescheduledFor on the row but stops showing it prominently.
            The Reopen button sits at the bottom of the callout so the
            unpark affordance lives next to the parked-state context. */}
        {inspection.status === "RESCHEDULED" && inspection.rescheduledFor && (
          <section className="rounded-xl border border-sandstone-200 bg-sandstone-50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="w-4 h-4 text-ink-2" />
              <div className="text-[10px] font-semibold text-ink-2 uppercase tracking-wider">
                Rescheduled — reopens {fmtDate(inspection.rescheduledFor)}
              </div>
            </div>
            {inspection.rescheduledNote && (
              <p className="text-sm text-ink leading-snug mt-1">“{inspection.rescheduledNote}”</p>
            )}
            <MobileQaqcReopenAction
              inspectionId={inspection.id}
              expectedUpdatedAt={inspection.updatedAt.toISOString()}
            />
          </section>
        )}

        {/* Final Remark · the note the filler left at Send For Review
            time. Colab labels this section "Final Remark" on the
            Approval Checklist screen — matching the label so the
            reviewer's muscle memory carries over. */}
        {inspection.submitRemark && (
          <section className="rounded-xl overflow-hidden border border-stone-200 bg-white">
            <div className="bg-ink text-white px-3 py-2 text-xs font-semibold uppercase tracking-wider">
              Final Remark
            </div>
            <div className="p-3">
              <div className="rounded-md border-2 border-dashed border-amber-300 bg-white px-3 py-2 text-sm text-ink whitespace-pre-wrap">
                {inspection.submitRemark}
              </div>
            </div>
          </section>
        )}

        {/* Assigned reviewers · surfaces who the filler asked to look at
            this. When empty, the WIR fell back to the role broadcast so
            the card is omitted rather than shown with "everyone", which
            would read as more specific than it is. */}
        {assignedReviewers.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2">
              <UsersIcon className="w-4 h-4 text-stone-400" />
              <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                Reviewers · {assignedReviewers.length}
              </div>
            </div>
            <ul className="space-y-1">
              {assignedReviewers.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm text-stone-900">
                  <span className="w-6 h-6 rounded-full bg-sandstone-100 text-ink-2 flex items-center justify-center text-[11px] font-semibold shrink-0">
                    {(r.name ?? r.username).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="font-medium">{r.name ?? r.username}</span>
                  <span className="text-[11px] text-stone-500 ml-auto lowercase">
                    {r.role.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Checklist */}
        <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-stone-100 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
            Checklist · {inspection.items.length} item{inspection.items.length === 1 ? "" : "s"}
          </div>
          {inspection.items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-stone-400">No checklist items on this inspection.</div>
          ) : (
            <ul>
              {inspection.items.map((item) => (
                <li key={item.id} className="border-b border-stone-100 last:border-b-0 px-3 py-2.5 space-y-2">
                  <div className="flex items-start gap-3">
                    <ItemMark passed={item.passed} notApplicable={item.notApplicable} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-stone-900 leading-snug">{item.label}</div>
                      {item.notes && (
                        <div className="text-[11px] text-stone-500 mt-0.5 italic">
                          “{item.notes}”
                        </div>
                      )}
                    </div>
                    {/* Per-item photo (Colab step 6). The filler captured a
                        single close-up of the checkpoint; the reviewer sees
                        it inline, tap opens the full image in a new tab. */}
                    {item.photoUrl && (
                      <a
                        href={item.photoUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="w-12 h-12 flex-none rounded-lg overflow-hidden border border-stone-200 bg-stone-50 block"
                        aria-label="Open checkpoint photo"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </a>
                    )}
                  </div>

                  {/* Colab-parity "Approver 1" row · appears while the WIR
                      is IN_REVIEW so the reviewer can leave a comment,
                      photo, or flag the checkpoint as an issue. Interactive
                      pieces live in the client component so the tap
                      handlers can call the per-item PATCH endpoint. */}
                  {inspection.status === "IN_REVIEW" && iCanReview && (
                    <MobileInspectionItemReviewerControls
                      projectId={projectId}
                      inspectionId={inspection.id}
                      itemId={item.id}
                      wbsNodeId={inspection.wbsNode?.id ?? null}
                      initialNote={item.reviewerNote}
                      initialPhotoUrl={item.reviewerPhotoUrl}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Photos */}
        {inspection.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {inspection.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {inspection.photos.map((p) => (
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

        {/* Colab-parity "Approvers" section at the bottom of the WIR
            detail. Matches Girish screen 23 layout: dark ink header,
            per-level subheader with status pill, then a card per
            approver with name/role + status + optional remark +
            timestamp. Single-approver on White Lotus so we render one
            row per level.
            - PENDING (WIR is IN_REVIEW): show the assigned reviewers
              as awaiting.
            - APPROVED (PASSED): show the actual reviewer as approved.
            - REJECTED: show as rejected, with the rejectionReason as
              the remark. */}
        <section className="rounded-xl overflow-hidden border border-stone-200 bg-white">
          <div className="bg-ink text-white px-3 py-2 text-xs font-semibold uppercase tracking-wider">
            Approvers
          </div>
          <div className="px-3 py-3 space-y-3">
            <div className="flex items-center justify-center gap-3 text-xs">
              <div className="h-px flex-1 bg-stone-200" />
              <span className="font-semibold text-ink">Level 1 (Level 1)</span>
              <ApproverLevelPill status={inspection.status} />
              <div className="h-px flex-1 bg-stone-200" />
            </div>
            {inspection.status === "IN_REVIEW" ? (
              assignedReviewers.length === 0 ? (
                <div className="text-center text-xs text-stone-500 italic">
                  No specific reviewer picked — the WIR is broadcast to the
                  planner + product + admin queue.
                </div>
              ) : (
                assignedReviewers.map((r) => (
                  <ApproverCard
                    key={r.id}
                    name={r.name ?? r.username}
                    roleLabel={roleLabel(r.role)}
                    statusLabel="Pending"
                    statusTone="pending"
                    remark={null}
                    timestamp={null}
                  />
                ))
              )
            ) : (
              <ApproverCard
                name={inspection.reviewedBy?.name ?? "—"}
                roleLabel={null}
                statusLabel={inspection.status === "PASSED" ? "Approved" : "Rejected"}
                statusTone={inspection.status === "PASSED" ? "approved" : "rejected"}
                remark={inspection.rejectionReason ?? null}
                timestamp={inspection.reviewedAt ? fmtDateTime(inspection.reviewedAt) : null}
              />
            )}
          </div>
        </section>
      </div>

      {/* Sticky bottom bar — three variants depending on status.
            DRAFT     → filler-only Delete-draft button. No reviewer
                        actions; a draft hasn't been sent for review.
            RESCHEDULED → owns its bar in the sandstone callout above
                        (the Reopen button). Nothing sticky here.
            other     → Pass/Reject for reviewers on IN_REVIEW; the
                        "already reviewed" hint on PASSED/REJECTED. */}
      {inspection.status === "DRAFT" && iAmTheFiller && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <MobileQaqcDraftActions
            inspectionId={inspection.id}
            projectId={projectId}
            title={inspection.title}
          />
        </div>
      )}
      {iCanReview && inspection.status !== "RESCHEDULED" && inspection.status !== "DRAFT" && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <MobileQaqcReviewActions
            inspectionId={inspection.id}
            currentStatus={inspection.status as "IN_REVIEW" | "PASSED" | "REJECTED"}
            expectedUpdatedAt={inspection.updatedAt.toISOString()}
            projectId={projectId}
            moduleFilter={reviewModuleFilter}
          />
        </div>
      )}
    </div>
  );
}

function ItemMark({ passed, notApplicable }: { passed: boolean | null; notApplicable: boolean }) {
  // NA is a real construction answer for scope items that don't apply to this
  // specific villa/section — read it first so it wins over passed=null.
  if (notApplicable) {
    return (
      <span className="w-6 h-6 rounded-full bg-stone-100 ring-1 ring-stone-300 text-stone-600 flex items-center justify-center shrink-0 text-[9.5px] font-semibold tracking-tight">
        N/A
      </span>
    );
  }
  if (passed === true) {
    return (
      <span className="w-6 h-6 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-4 h-4" />
      </span>
    );
  }
  if (passed === false) {
    return (
      <span className="w-6 h-6 rounded-full bg-red-50 ring-1 ring-red-200 text-red-700 flex items-center justify-center shrink-0">
        <X className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="w-6 h-6 rounded-full bg-stone-50 ring-1 ring-stone-200 text-stone-400 flex items-center justify-center shrink-0">
      <Clock className="w-3.5 h-3.5" />
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 }> = {
    IN_REVIEW: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "In review", Icon: Clock },
    PASSED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Passed", Icon: CheckCircle2 },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected", Icon: X },
    RESCHEDULED: { bg: "bg-sandstone-100 ring-sandstone-200", fg: "text-ink-2", label: "Rescheduled", Icon: CalendarClock },
    DRAFT: { bg: "bg-stone-100 ring-stone-300", fg: "text-stone-700", label: "Draft", Icon: FileEdit },
  };
  const cfg = map[status] ?? map.IN_REVIEW;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.fg}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtDateTime(d: Date): string {
  // Colab-parity — Approvers section shows "29 Sep 2026, 06:28 PM"
  // Time pinned to IST for the same reason as fmtDate: server-tz
  // rendering on Vercel would show UTC times, off by 5.5 hours.
  const date = fmtDate(d);
  const time = new Date(d).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  return `${date}, ${time}`;
}

function roleLabel(role: string): string {
  // Small helper for the Approvers section — human labels for the
  // reviewer's role field. Falls back to the raw role string.
  const map: Record<string, string> = {
    PLANNER: "Planner",
    PRODUCT_TEAM: "Product Team",
    ADMIN: "Admin",
    SITE_MANAGER: "Site Manager",
    SITE_ENGINEER: "Site Engineer",
  };
  return map[role] ?? role;
}

function ApproverLevelPill({ status }: { status: string }) {
  if (status === "PASSED")
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
        Approved
      </span>
    );
  if (status === "REJECTED")
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
        Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
      Pending
    </span>
  );
}

function ApproverCard({
  name,
  roleLabel,
  statusLabel,
  statusTone,
  remark,
  timestamp,
}: {
  name: string;
  roleLabel: string | null;
  statusLabel: string;
  statusTone: "approved" | "rejected" | "pending";
  remark: string | null;
  timestamp: string | null;
}) {
  const pill =
    statusTone === "approved"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
      : statusTone === "rejected"
        ? "bg-red-100 text-red-800 ring-red-200"
        : "bg-amber-100 text-amber-800 ring-amber-200";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink leading-snug">{name}</p>
          {roleLabel && (
            <p className="text-[11px] text-stone-500 mt-0.5">{roleLabel}</p>
          )}
          <p className="text-[10px] text-stone-400 mt-1 uppercase tracking-wider">
            Approver
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[11px] font-semibold ${pill}`}
        >
          {statusLabel}
        </span>
      </div>
      {remark && (
        <p className="text-sm text-ink mt-2 whitespace-pre-wrap">
          <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-0.5">
            Remark
          </span>
          {remark}
        </p>
      )}
      {timestamp && (
        <p className="text-[11px] text-stone-500 mt-2">{timestamp}</p>
      )}
    </div>
  );
}

/**
 * Detail-hero variant of the list card's AgingChip. Same math, same
 * tier→color mapping, slightly larger paddings to match the hero's
 * denser rhythm. Kept as a local helper (not shared) so the two
 * surfaces can style independently as the design evolves without
 * pulling on one another.
 */
function DetailAgingChip({ createdAt }: { createdAt: Date }) {
  const age = wirAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
      title={`Filed ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}
