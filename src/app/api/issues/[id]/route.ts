import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const STATUSES = new Set(["OPEN", "RESOLVED"]);

export async function PATCH(req: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const { status, assignedToId } = (body ?? {}) as {
    status?: string;
    assignedToId?: string | null;
  };

  // Status changes (OPEN → RESOLVED, etc.) and reassignment are reviewer-only.
  if ((status !== undefined || assignedToId !== undefined) && !canReview(session.user.role)) {
    return forbidden();
  }

  const data: { status?: string; assignedToId?: string | null } = {};
  if (status !== undefined) {
    if (!STATUSES.has(status)) return badRequest("Invalid status");
    data.status = status;
  }
  if (assignedToId !== undefined) {
    if (assignedToId === null || assignedToId === "") {
      data.assignedToId = null;
    } else {
      const user = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true },
      });
      if (!user) return badRequest("Assignee not found");
      data.assignedToId = assignedToId;
    }
  }

  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const before = await prisma.issue.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, assignedToId: true },
    });
    // findUnique is soft-delete filtered, so a null here means the snag is
    // missing or trashed — don't silently mutate it.
    if (!before) return notFound();
    const issue = await prisma.issue.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });
    {
      const diff = diffSummary(
        { status: before.status, assignedToId: before.assignedToId },
        { status: issue.status, assignedToId: issue.assignedToId },
      );
      const isStatusChange = before.status !== issue.status;
      await recordAudit({
        projectId: issue.projectId,
        userId: session.user.id,
        action: isStatusChange ? "STATUS_CHANGE" : "UPDATE",
        entityType: "Issue",
        entityId: issue.id,
        summary:
          diff.summary ||
          (isStatusChange ? `Snag → ${issue.status}` : "Snag updated"),
        changes: diff.changes,
      });
    }
    return NextResponse.json({ issue });
  } catch (e) {
    return handleApiError(e, "PATCH /api/issues/:id");
  }
}
