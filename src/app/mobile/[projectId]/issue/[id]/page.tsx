import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import MobileIssueActions from "@/components/mobile/MobileIssueActions";

export const dynamic = "force-dynamic";

/**
 * Mobile snag detail. Read-only body (description, photos, meta) plus a
 * sticky action bar at the bottom for the two people who legitimately act
 * on a snag from a phone:
 *
 *   - the ASSIGNEE (contractor who has to rectify) — can flip
 *     Open → In Reinspection to signal "please come re-check"
 *   - a REVIEWER — can mark Resolved, or send an in-reinspection snag
 *     back to Open when more work is needed
 *
 * All server-side gating (module scope, role, ownership on the
 * reinspection carve-out) is duplicated in `/api/issues/[id]` PATCH, so
 * the client bar is the UX signal, not the security surface.
 */
export default async function MobileIssueDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    redirect(`/mobile/${projectId}`);
  }

  const issue = await prisma.issue.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!issue) notFound();

  // Module isolation belt — a QAQC-scoped contractor cannot open a SAFETY
  // snag and vice-versa. The API PATCH refuses too, but blocking at read
  // keeps the URL from leaking the row's title/photos.
  if (!canAccessScopedRow(session.user.modules, issue.module)) {
    redirect(`/mobile/${projectId}/issue`);
  }

  const iCanReview = canReview(session.user.role);
  const iAmAssignee = issue.assignedToId === session.user.id;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Hero band — sandstone gradient matches the list and every other
          mobile screen. Description is the identity here (snag titles
          aren't a thing), so it sits at H1 scale. */}
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-3 uppercase tracking-[0.14em] font-semibold">
          <StatusPill status={issue.status} />
          {issue.severity && <SeverityPill severity={issue.severity} />}
          {issue.module && (
            <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5">
              {issue.module === "SAFETY" ? "EHS" : "QA/QC"}
            </span>
          )}
        </div>
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {issue.description}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Meta card — who, where, when. Same shape as the QA/QC detail
            page's Who/Where card so the two feel like a set. */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised by</span>
            <span className="font-medium">{issue.createdBy.name}</span>
          </div>
          {issue.assignedTo && (
            <div className="flex items-center gap-2 text-stone-700">
              <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Assigned to</span>
              <span className="font-medium">{issue.assignedTo.name}</span>
            </div>
          )}
          {issue.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{issue.wbsNode.name}</span>
            </div>
          )}
          {issue.category && (
            <div className="flex items-center gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Category</span>
              <span className="font-medium">{issue.category}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
            <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised</span>
            <span className="font-medium">{fmtDate(issue.createdAt)}</span>
          </div>
        </section>

        {/* Photos */}
        {issue.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {issue.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {issue.photos.map((p) => (
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

      {/* Sticky action bar — the component decides what buttons to show
          based on role / ownership; it renders nothing when the current
          user has no legitimate action to take. */}
      {(iCanReview || iAmAssignee) && issue.status !== "RESOLVED" && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          <MobileIssueActions
            issueId={issue.id}
            currentStatus={issue.status as "OPEN" | "IN_REINSPECTION" | "RESOLVED"}
            expectedUpdatedAt={issue.updatedAt.toISOString()}
            projectId={projectId}
            iCanReview={iCanReview}
            iAmAssignee={iAmAssignee}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    OPEN: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Open" },
    IN_REINSPECTION: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "In reinspection" },
    RESOLVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Resolved" },
  };
  const cfg = map[status] ?? map.OPEN;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    HIGH: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "High" },
    MEDIUM: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Med" },
    LOW: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700", label: "Low" },
  };
  const cfg = map[severity];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

