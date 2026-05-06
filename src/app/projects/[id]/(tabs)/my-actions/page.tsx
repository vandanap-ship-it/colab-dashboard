import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import MyActionsCard, { type CardItem, type Chip } from "@/components/MyActionsCard";

function clip(text: string, max = 80) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function fmt(d: Date) {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default async function MyActionsTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) notFound();

  const userId = session.user.id;
  const role = session.user.role;
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;

  // ---- My Task: concerns escalated to TASK_ASSIGNED ----
  const [tasksAssignedToMe, tasksAssignedByMe] = await Promise.all([
    prisma.concern.findMany({
      where: { projectId, status: "TASK_ASSIGNED", assignedToId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
      },
    }),
    prisma.concern.findMany({
      where: { projectId, status: "TASK_ASSIGNED", raisedById: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
  ]);

  // ---- Issues ----
  const [issuesAssignedToMe, issuesCreatedByMe, allOpenIssues] = await Promise.all([
    prisma.issue.findMany({
      where: { projectId, status: "OPEN", assignedToId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
        severity: true,
      },
    }),
    prisma.issue.findMany({
      where: { projectId, status: "OPEN", createdById: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
        severity: true,
      },
    }),
    prisma.issue.count({ where: { projectId, status: "OPEN" } }),
  ]);

  // ---- Area Of Concern (PENDING / READ — i.e. not yet a task, not resolved) ----
  const [concernsAssignedToMe, concernsCreatedByMe] = await Promise.all([
    prisma.concern.findMany({
      where: {
        projectId,
        status: { in: ["PENDING", "READ"] },
        assignedToId: userId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        status: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
      },
    }),
    prisma.concern.findMany({
      where: {
        projectId,
        status: { in: ["PENDING", "READ"] },
        raisedById: userId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        description: true,
        status: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
      },
    }),
  ]);

  // ---- CheckList (Inspections) ----
  const [inspectionsByMe, inspectionsPendingReview] = await Promise.all([
    prisma.inspection.findMany({
      where: { projectId, filledById: userId },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        wbsNode: { select: { name: true } },
      },
    }),
    canReviewInspections
      ? prisma.inspection.findMany({
          where: { projectId, status: "IN_REVIEW" },
          orderBy: { updatedAt: "desc" },
          take: 25,
          select: {
            id: true,
            title: true,
            updatedAt: true,
            wbsNode: { select: { name: true } },
            filledBy: { select: { name: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            title: string;
            updatedAt: Date;
            wbsNode: { name: string } | null;
            filledBy: { name: string | null } | null;
          }>,
        ),
  ]);

  // ---- Map results to card items ----
  const taskAssignedItems: CardItem[] = tasksAssignedToMe.map((c) => ({
    id: c.id,
    title: clip(c.description),
    subtitle: `${c.wbsNode?.name ?? "—"} · updated ${fmt(c.updatedAt)}`,
  }));
  const taskAssignedByMeItems: CardItem[] = tasksAssignedByMe.map((c) => ({
    id: c.id,
    title: clip(c.description),
    subtitle: `${c.assignedTo?.name ? `→ ${c.assignedTo.name} · ` : ""}${c.wbsNode?.name ?? "—"} · updated ${fmt(c.updatedAt)}`,
  }));

  const issuesAssignedItems: CardItem[] = issuesAssignedToMe.map((it) => ({
    id: it.id,
    title: clip(it.description),
    subtitle: `${it.severity ? it.severity + " · " : ""}${it.wbsNode?.name ?? "—"} · updated ${fmt(it.updatedAt)}`,
  }));
  const issuesCreatedItems: CardItem[] = issuesCreatedByMe.map((it) => ({
    id: it.id,
    title: clip(it.description),
    subtitle: `${it.severity ? it.severity + " · " : ""}${it.wbsNode?.name ?? "—"} · updated ${fmt(it.updatedAt)}`,
  }));

  const concernAssignedItems: CardItem[] = concernsAssignedToMe.map((c) => ({
    id: c.id,
    title: clip(c.description),
    subtitle: `${c.status} · ${c.wbsNode?.name ?? "—"} · updated ${fmt(c.updatedAt)}`,
  }));
  const concernCreatedItems: CardItem[] = concernsCreatedByMe.map((c) => ({
    id: c.id,
    title: clip(c.description),
    subtitle: `${c.status} · ${c.wbsNode?.name ?? "—"} · updated ${fmt(c.updatedAt)}`,
  }));

  const inspectionByMeItems: CardItem[] = inspectionsByMe.map((ins) => ({
    id: ins.id,
    title: clip(ins.title),
    subtitle: `${ins.status} · ${ins.wbsNode?.name ?? "—"} · updated ${fmt(ins.updatedAt)}`,
  }));
  const inspectionReviewItems: CardItem[] = inspectionsPendingReview.map((ins) => ({
    id: ins.id,
    title: clip(ins.title),
    subtitle: `${ins.filledBy?.name ? "by " + ins.filledBy.name + " · " : ""}${ins.wbsNode?.name ?? "—"} · updated ${fmt(ins.updatedAt)}`,
  }));

  // ---- Card configs ----
  const taskChips: Chip[] = [
    { key: "assigned-to-me", label: "Assign To Me", count: taskAssignedItems.length },
    { key: "assigned-by-me", label: "Assigned By Me", count: taskAssignedByMeItems.length },
  ];

  const issueChips: Chip[] = [
    { key: "assigned-to-me", label: "Assign To Me", count: issuesAssignedItems.length },
    { key: "created-by-me", label: "Created By Me", count: issuesCreatedItems.length },
  ];

  const concernChips: Chip[] = [
    { key: "assigned-to-me", label: "Assign To Me", count: concernAssignedItems.length },
    { key: "created-by-me", label: "Created By Me", count: concernCreatedItems.length },
  ];

  const inspectionChips: Chip[] = [
    { key: "by-me", label: "Created By Me", count: inspectionByMeItems.length },
    ...(canReviewInspections
      ? [
          {
            key: "pending-review",
            label: "Pending Review",
            count: inspectionReviewItems.length,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
          Dashboard
        </h2>
        <p className="text-xs text-stone-500 mt-1">
          Everything across this project that&apos;s pointed at you. Switch chips to filter
          each card.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MyActionsCard
          title="My Task"
          totalCount={taskAssignedItems.length + taskAssignedByMeItems.length}
          chips={taskChips}
          panels={{
            "assigned-to-me": {
              items: taskAssignedItems,
              emptyText: "No tasks assigned to you.",
            },
            "assigned-by-me": {
              items: taskAssignedByMeItems,
              emptyText: "You haven't assigned any tasks yet.",
            },
          }}
        />

        <MyActionsCard
          title="Snags"
          totalCount={allOpenIssues}
          chips={issueChips}
          panels={{
            "assigned-to-me": {
              items: issuesAssignedItems,
              emptyText: "No snags assigned to you.",
            },
            "created-by-me": {
              items: issuesCreatedItems,
              emptyText: "No open snags you raised.",
            },
          }}
        />

        <MyActionsCard
          title="Area Of Concern"
          totalCount={concernAssignedItems.length + concernCreatedItems.length}
          chips={concernChips}
          panels={{
            "assigned-to-me": {
              items: concernAssignedItems,
              emptyText: "No concerns assigned to you.",
            },
            "created-by-me": {
              items: concernCreatedItems,
              emptyText: "You haven't raised any open concerns.",
            },
          }}
        />

        <MyActionsCard
          title="CheckList"
          totalCount={
            inspectionByMeItems.length +
            (canReviewInspections ? inspectionReviewItems.length : 0)
          }
          chips={inspectionChips}
          panels={{
            "by-me": {
              items: inspectionByMeItems,
              emptyText: "No inspections raised by you.",
            },
            "pending-review": {
              items: inspectionReviewItems,
              emptyText: "Nothing waiting on review.",
            },
          }}
        />
      </div>
    </div>
  );
}
