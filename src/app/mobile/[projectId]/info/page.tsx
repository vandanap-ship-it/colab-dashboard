import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, ClipboardCheck, ListChecks, Pin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";

export default async function MobileInfoPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const userId = session.user.id;
  const role = session.user.role;
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;

  const [concernsAssigned, issuesAssigned, issuesCreatedByMe, inspectionsToReview] =
    await Promise.all([
      prisma.concern.count({
        where: {
          projectId,
          status: { in: ["TASK_ASSIGNED", "PENDING"] },
          assignedToId: userId,
        },
      }),
      prisma.issue.count({ where: { projectId, status: "OPEN", assignedToId: userId } }),
      prisma.issue.count({ where: { projectId, status: "OPEN", createdById: userId } }),
      canReviewInspections
        ? prisma.inspection.count({ where: { projectId, status: "IN_REVIEW" } })
        : Promise.resolve(0),
    ]);

  const totalActions = concernsAssigned + issuesAssigned + inspectionsToReview;

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 tracking-tight">My Actions</h1>
        <p className="text-xs text-stone-500 mt-1">{project.name}</p>
      </div>

      {/* Hero count card */}
      <section className="rounded-2xl bg-stone-900 text-white p-6 text-center shadow-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 0%, rgba(251, 191, 36, 0.18), transparent 50%), radial-gradient(circle at 100% 100%, rgba(251, 191, 36, 0.08), transparent 40%)",
          }}
        />
        <div className="relative">
          <p className="text-xs uppercase tracking-widest text-stone-400">Total actions</p>
          <p className="mt-2 text-5xl font-semibold tracking-tight text-brand-400 tabular-nums">
            {totalActions}
          </p>
          <p className="text-xs text-stone-400 mt-2">
            {totalActions === 0 ? "Nothing on your plate. Nice." : "Items waiting on you."}
          </p>
        </div>
      </section>

      <Link
        href={`/mobile/${projectId}/site-progress`}
        className="rounded-xl border border-stone-200 bg-white p-4 flex items-center gap-3 hover:border-stone-300 hover:shadow-soft active:scale-[0.99] transition-all"
      >
        <span className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
          <ListChecks className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-900">Progress</div>
          <div className="text-xs text-stone-500 mt-0.5">Activities to update</div>
        </div>
        <ArrowRight className="w-4 h-4 text-stone-300" />
      </Link>

      <ActionRow
        icon={Pin}
        title="Tasks Assigned To Me"
        sub="Concerns escalated to you"
        count={concernsAssigned}
      />

      <ActionRow
        icon={AlertTriangle}
        title="Snags Assigned To Me"
        sub="Open snags you need to handle"
        count={issuesAssigned}
      />

      <ActionRow
        icon={AlertTriangle}
        title="Snags I Created"
        sub="Open snags you raised"
        count={issuesCreatedByMe}
      />

      {canReviewInspections && (
        <ActionRow
          icon={ClipboardCheck}
          title="Inspections Pending Review"
          sub="Awaiting your sign-off"
          count={inspectionsToReview}
        />
      )}
    </div>
  );
}

function ActionRow({
  icon: Icon,
  title,
  sub,
  count,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  count: number;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 flex items-center gap-3">
      <span className="w-10 h-10 rounded-lg bg-stone-100 text-stone-600 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-stone-900">{title}</div>
        <div className="text-xs text-stone-500 mt-0.5">{sub}</div>
      </div>
      {count > 0 ? (
        <span className="rounded-full bg-stone-900 text-white text-xs font-semibold px-2.5 py-0.5 min-w-[28px] text-center tabular-nums">
          {count}
        </span>
      ) : (
        <span className="text-xs text-stone-400">0</span>
      )}
    </div>
  );
}
