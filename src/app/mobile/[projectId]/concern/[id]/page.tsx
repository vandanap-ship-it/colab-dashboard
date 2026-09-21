import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import MobileConcernActions from "@/components/mobile/MobileConcernActions";

export const dynamic = "force-dynamic";

/**
 * Mobile Concern detail — same shape as the Issue detail so the two workflows
 * feel like siblings. Status pill (Pending / Read / Task assigned / Resolved),
 * Fraunces description, meta card, photo grid, sticky action bar.
 */
export default async function MobileConcernDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.CONCERN)) {
    redirect(`/mobile/${projectId}`);
  }

  const concern = await prisma.concern.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!concern) notFound();

  const iCanReview = canReview(session.user.role);
  // Non-reviewer only sees the action bar when there's an action to take —
  // which is only "acknowledge" on a PENDING concern. Everything else is
  // reviewer-only.
  const showBar =
    iCanReview ||
    (concern.status === "PENDING");

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <StatusPill status={concern.status} />
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {concern.description}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised by</span>
            <span className="font-medium">{concern.raisedBy.name}</span>
          </div>
          {concern.assignedTo && (
            <div className="flex items-center gap-2 text-stone-700">
              <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Assigned to</span>
              <span className="font-medium">{concern.assignedTo.name}</span>
            </div>
          )}
          {concern.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{concern.wbsNode.name}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
            <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised</span>
            <span className="font-medium">{fmtDate(concern.createdAt)}</span>
          </div>
        </section>

        {concern.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {concern.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {concern.photos.map((p) => (
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
          <MobileConcernActions
            concernId={concern.id}
            currentStatus={concern.status as "PENDING" | "READ" | "TASK_ASSIGNED" | "RESOLVED"}
            expectedUpdatedAt={concern.updatedAt.toISOString()}
            projectId={projectId}
            iCanReview={iCanReview}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Pending" },
    READ: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700", label: "Read" },
    TASK_ASSIGNED: { bg: "bg-sandstone-100 ring-sandstone-200", fg: "text-ink-2", label: "Task assigned" },
    RESOLVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Resolved" },
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
