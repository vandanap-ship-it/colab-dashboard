import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { isAdmin, ROLES } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import RfiActions from "@/components/RfiActions";
import {
  RFI_CATEGORY_LABELS,
  RFI_PRIORITY_LABELS,
  RFI_STATUS_LABELS,
  formatRfiNumber,
  type RfiCategory,
  type RfiPriority,
  type RfiStatus,
} from "@/lib/rfi";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<RfiStatus, { bg: string; fg: string }> = {
  OPEN: { bg: "#F7EAD5", fg: "#C77A2A" },
  ANSWERED: { bg: "#E9F0F7", fg: "#1E4266" },
  CLOSED: { bg: "#E4EFE8", fg: "#2E7D5B" },
};

export default async function RfiDetailPage({
  params,
}: {
  params: Promise<{ id: string; rfiId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/projects/${(await params).id}/snapshot`);
  }

  const { id: projectId, rfiId } = await params;
  const rfi = await prisma.rfi.findUnique({
    where: { id: rfiId },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      answeredBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!rfi || rfi.projectId !== projectId) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  const assignableUsers = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["PLANNER", "PRODUCT_TEAM", "ADMIN", "SITE_MANAGER"] },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const status = rfi.status as RfiStatus;
  const canAnswer =
    rfi.assignedToId === session.user.id ||
    isAdmin(session.user.role) ||
    session.user.role === ROLES.PLANNER ||
    session.user.role === ROLES.PRODUCT_TEAM;

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-8 space-y-6">
        <Link
          href={`/projects/${projectId}/rfi`}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to RFIs
        </Link>

        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-stone-500 mb-1">
              {formatRfiNumber(rfi.number)}
            </div>
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">{rfi.subject}</h1>
            <p className="text-sm text-stone-500 mt-1">
              {project?.name} · {RFI_CATEGORY_LABELS[rfi.category as RfiCategory] ?? rfi.category} ·{" "}
              {RFI_PRIORITY_LABELS[rfi.priority as RfiPriority] ?? rfi.priority} priority
            </p>
          </div>
          <span
            className="inline-block text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded"
            style={{ background: STATUS_STYLE[status].bg, color: STATUS_STYLE[status].fg }}
          >
            {RFI_STATUS_LABELS[status]}
          </span>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-5">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                Question
              </h2>
              <p className="text-sm text-stone-900 whitespace-pre-wrap">{rfi.description}</p>
              <div className="text-xs text-stone-400 mt-4">
                Raised by <span className="text-stone-600 font-medium">{rfi.raisedBy.name}</span>{" "}
                on {rfi.createdAt.toISOString().slice(0, 10)}
              </div>
            </section>

            {rfi.answer && (
              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                  Answer
                </h2>
                <p className="text-sm text-stone-900 whitespace-pre-wrap">{rfi.answer}</p>
                <div className="text-xs text-stone-400 mt-4">
                  Answered by <span className="text-stone-600 font-medium">{rfi.answeredBy?.name ?? "—"}</span>{" "}
                  on {rfi.answeredAt?.toISOString().slice(0, 10) ?? "—"}
                </div>
              </section>
            )}

            {rfi.photos.length > 0 && (
              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                  Photos
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {rfi.photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={p.id}
                      src={p.url}
                      alt="RFI attachment"
                      className="w-full aspect-square object-cover rounded"
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                Details
              </h2>
              <dl className="space-y-2 text-sm">
                <MetaRow k="Assignee" v={rfi.assignedTo?.name ?? <span className="italic text-stone-400">Unassigned</span>} />
                <MetaRow k="Due" v={rfi.dueDate ? rfi.dueDate.toISOString().slice(0, 10) : "—"} />
                {rfi.wbsNode && (
                  <MetaRow
                    k="Activity"
                    v={<span className="font-mono text-xs">{rfi.wbsNode.taskCode} · {rfi.wbsNode.name}</span>}
                  />
                )}
              </dl>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
                Actions
              </h2>
              <RfiActions
                rfiId={rfi.id}
                currentStatus={status}
                currentAssigneeId={rfi.assignedToId}
                assignableUsers={assignableUsers}
                canAnswer={canAnswer}
              />
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-xs text-stone-500 uppercase tracking-wider">{k}</dt>
      <dd className="text-stone-900">{v}</dd>
    </div>
  );
}
