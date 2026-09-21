import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar, MapPin, Clock, Flame } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import {
  WORK_PERMIT_TYPE_LABELS,
  parseApproverIds,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";
import MobilePermitActions from "@/components/mobile/MobilePermitActions";

export const dynamic = "force-dynamic";

/**
 * Mobile Work Permit detail. Renders the permit's whole shape (type, title,
 * dates and time window, requester, location, description, photos), then a
 * sticky action bar that adapts to the viewer's role. All PATCH gates live
 * in /api/work-permits/[id]; this component just steers UX.
 */
export default async function MobilePermitDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
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
    },
  });
  if (!permit) notFound();

  const iAmRequester = permit.requesterId === session.user.id;
  const approverIds = parseApproverIds(permit.approverIds);
  const iAmApprover = approverIds.includes(session.user.id);
  const showBar =
    (iAmApprover && (permit.status === "PENDING" || permit.status === "APPROVED")) ||
    (iAmRequester && permit.status === "APPROVED");

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold uppercase tracking-[0.14em]">
          <StatusPill status={permit.status} />
          <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold text-[9.5px]">
            {WORK_PERMIT_TYPE_LABELS[permit.type as WorkPermitType] ?? permit.type}
          </span>
        </div>
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {permit.title}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {permit.description && (
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
              {permit.description}
            </p>
          </section>
        )}

        {/* When and where */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
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
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Location</span>
              <span className="font-medium leading-snug">{permit.location}</span>
            </div>
          )}
          {permit.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{permit.wbsNode.name}</span>
            </div>
          )}
        </section>

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

        {/* Rejection reason — only for REJECTED permits with a reason */}
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

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
