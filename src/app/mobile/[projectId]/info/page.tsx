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
    <div className="px-5 py-5 space-y-4">
      <div>
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          What&apos;s on your plate
        </p>
        <h1 className="font-serif text-[28px] leading-tight text-ink mt-1 tracking-tight">
          My actions
        </h1>
        <p className="text-[13px] text-ink-3 mt-1.5">{project.name}</p>
      </div>

      {/* Hero count card — ink ground for gravitas, Fraunces numeric for
          brand consistency with the home's Site Pulse. */}
      <section className="rounded-2xl bg-ink text-cream p-6 text-center shadow-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 0%, rgba(197, 106, 64, 0.24), transparent 50%), radial-gradient(circle at 100% 100%, rgba(251, 191, 36, 0.08), transparent 40%)",
          }}
        />
        <div className="relative">
          <p className="text-[10.5px] uppercase tracking-[0.16em] text-cream/60">Total actions</p>
          <p
            className="mt-2 font-serif text-ferrous-300 tabular-nums"
            style={{ fontSize: "56px", lineHeight: "1", letterSpacing: "-0.02em" }}
          >
            {totalActions}
          </p>
          <p className="text-[12px] text-cream/60 mt-3">
            {totalActions === 0 ? "Nothing on your plate. Nice." : "Items waiting on you."}
          </p>
        </div>
      </section>

      <Link
        href={`/mobile/${projectId}/site-progress`}
        className="rounded-2xl border border-sandstone-100 bg-cream p-4 flex items-center gap-3 shadow-soft active:scale-[0.99] transition-all"
      >
        <span className="w-10 h-10 rounded-lg bg-ferrous-50 text-ferrous-600 flex items-center justify-center shrink-0">
          <ListChecks className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-ink">Site progress</div>
          <div className="text-[12px] text-ink-3 mt-0.5">Villa-by-villa completion</div>
        </div>
        <ArrowRight className="w-4 h-4 text-ink-3" />
      </Link>

      {/* All four rows deep-link into the desktop Snapshot / QA/QC surfaces
          via the same href pattern. Native mobile lists for each are a
          follow-up; for now the desktop views work fine on a phone browser
          and taking a dead-tap-row to a working target is a strict UX
          upgrade over the pre-fix "nothing happens on tap". */}
      <ActionRow
        icon={Pin}
        title="Tasks Assigned To Me"
        sub="Concerns escalated to you"
        count={concernsAssigned}
        href={`/projects/${projectId}/snapshot#concerns`}
      />

      <ActionRow
        icon={AlertTriangle}
        title="Snags Assigned To Me"
        sub="Open snags you need to handle"
        count={issuesAssigned}
        href={`/projects/${projectId}/snapshot#snags`}
      />

      <ActionRow
        icon={AlertTriangle}
        title="Snags I Created"
        sub="Open snags you raised"
        count={issuesCreatedByMe}
        href={`/projects/${projectId}/snapshot#snags`}
      />

      {canReviewInspections && (
        <ActionRow
          icon={ClipboardCheck}
          title="Inspections Pending Review"
          sub="Awaiting your sign-off"
          count={inspectionsToReview}
          href={`/mobile/${projectId}/qaqc?tab=pending`}
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
  href,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  count: number;
  /** Optional deep-link. When set the row renders as a Link with a caret;
   *  when omitted it stays a static counter tile. Prevents dead-taps on
   *  rows we don't have a mobile target for yet. */
  href?: string;
}) {
  const body = (
    <>
      <span className="w-10 h-10 rounded-lg bg-sandstone-50 text-ink-2 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        <div className="text-[12px] text-ink-3 mt-0.5">{sub}</div>
      </div>
      {count > 0 ? (
        <span className="rounded-full bg-ink text-cream text-[12px] font-semibold px-2.5 py-0.5 min-w-[28px] text-center tabular-nums">
          {count}
        </span>
      ) : (
        <span className="text-[12px] text-ink-3">0</span>
      )}
      {href && <ArrowRight className="w-4 h-4 text-ink-3 shrink-0" />}
    </>
  );
  const shell = "rounded-2xl border border-sandstone-100 bg-cream p-4 flex items-center gap-3 shadow-soft";
  if (href) {
    return (
      <Link href={href} className={`${shell} active:bg-sandstone-50`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
