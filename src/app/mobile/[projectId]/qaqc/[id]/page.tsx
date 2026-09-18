import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, X, Clock, User as UserIcon, Camera } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import MobileQaqcReviewActions from "@/components/mobile/MobileQaqcReviewActions";

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

  // Module gate — a QAQC-scoped user cannot open a SAFETY inspection and vice
  // versa. Server-side belt matches the API's own belt-and-braces.
  if (!canAccessScopedRow(session.user.modules, inspection.module)) {
    redirect(`/mobile/${projectId}/qaqc`);
  }

  const iCanReview = canReview(session.user.role);
  const backTab = tab && ["pending", "all", "passed", "rejected"].includes(tab) ? tab : "pending";
  // Preserve the split-view context (?module=QAQC or ?module=SAFETY) on
  // Back so an inspector who dove into a record from the EHS list lands
  // back on EHS, not the combined view.
  const backModule = moduleParam === "QAQC" || moduleParam === "SAFETY" ? moduleParam : "";
  const backHref = `/mobile/${projectId}/qaqc?tab=${backTab}${backModule ? `&module=${backModule}` : ""}`;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-stone-200">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to list
        </Link>

        <h1 className="text-lg font-bold text-stone-900 mt-2 leading-snug">
          {inspection.title}
        </h1>

        <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-stone-500">
          <StatusPill status={inspection.status} />
          {inspection.module && (
            <span className="rounded-full bg-stone-100 text-stone-700 px-2 py-0.5 font-semibold uppercase tracking-wider text-[9.5px]">
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
                <li key={item.id} className="border-b border-stone-100 last:border-b-0 px-3 py-2.5 flex items-start gap-3">
                  <ItemMark passed={item.passed} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-900 leading-snug">{item.label}</div>
                    {item.notes && (
                      <div className="text-[11px] text-stone-500 mt-0.5 italic">
                        “{item.notes}”
                      </div>
                    )}
                  </div>
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
      </div>

      {/* Sticky review actions — reviewers only. Server component decides
          who sees the bar; the client component owns the transitions. */}
      {iCanReview && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          <MobileQaqcReviewActions
            inspectionId={inspection.id}
            currentStatus={inspection.status as "IN_REVIEW" | "PASSED" | "REJECTED"}
            expectedUpdatedAt={inspection.updatedAt.toISOString()}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  );
}

function ItemMark({ passed }: { passed: boolean | null }) {
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
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
