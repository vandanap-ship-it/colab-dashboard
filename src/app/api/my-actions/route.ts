import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  const concernsWhere: { assignedToId: string; status: { in: string[] }; projectId?: string } = {
    assignedToId: session.user.id,
    status: { in: ["TASK_ASSIGNED", "PENDING"] },
  };
  if (projectId) concernsWhere.projectId = projectId;

  const concerns = await prisma.concern.findMany({
    where: concernsWhere,
    orderBy: { createdAt: "desc" },
    include: {
      raisedBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
    },
  });

  // Snags assigned to me + still open. /api/issues/[id] PATCH sends an
  // assignment email pointing at /my-actions, so an assignee who clicks the
  // link needs to actually see the snag here — previously they landed on
  // an empty page because /my-actions only returned concerns.
  const issuesWhere: { assignedToId: string; status: string; projectId?: string } = {
    assignedToId: session.user.id,
    status: "OPEN",
  };
  if (projectId) issuesWhere.projectId = projectId;

  const issues = await prisma.issue.findMany({
    where: issuesWhere,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
    },
  });

  const role = session.user.role;
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;

  let inspectionsToReview: Awaited<ReturnType<typeof prisma.inspection.findMany>> = [];
  if (canReviewInspections) {
    const inspWhere: { status: string; projectId?: string } = { status: "IN_REVIEW" };
    if (projectId) inspWhere.projectId = projectId;
    inspectionsToReview = await prisma.inspection.findMany({
      where: inspWhere,
      orderBy: { createdAt: "desc" },
      include: {
        filledBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
      },
    });
  }

  return NextResponse.json({
    concerns,
    issues,
    inspectionsToReview,
    total: concerns.length + issues.length + inspectionsToReview.length,
  });
}
