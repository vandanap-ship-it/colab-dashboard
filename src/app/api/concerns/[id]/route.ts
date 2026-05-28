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

const STATUSES = new Set(["PENDING", "READ", "RESOLVED", "TASK_ASSIGNED"]);

export async function PATCH(req: Request, ctx: RouteContext<"/api/concerns/[id]">) {
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

  // Permission rules:
  //   - RESOLVED  → reviewers only (Planner / Product Team / Admin)
  //   - TASK_ASSIGNED + assignedToId set → reviewers only (assigning is a planner action)
  //   - READ → anyone signed in (engineers can mark a concern read)
  //   - PENDING → reviewers only (re-opening)
  const wantsReview =
    status === "RESOLVED" ||
    status === "PENDING" ||
    status === "TASK_ASSIGNED" ||
    assignedToId !== undefined;
  if (wantsReview && !canReview(session.user.role)) {
    return forbidden();
  }

  const data: { status?: string; assignedToId?: string | null } = {};
  if (status && STATUSES.has(status)) data.status = status;
  if (assignedToId === null) data.assignedToId = null;
  else if (typeof assignedToId === "string" && assignedToId.length > 0) {
    // Verify user exists to surface a 400 instead of an FK error.
    const exists = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true },
    });
    if (!exists) return badRequest("Assignee not found");
    data.assignedToId = assignedToId;
    if (!status) data.status = "TASK_ASSIGNED";
  }

  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const before = await prisma.concern.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, assignedToId: true },
    });
    if (!before) return notFound();
    const concern = await prisma.concern.update({
      where: { id },
      data,
      include: {
        raisedBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });
    {
      const diff = diffSummary(
        { status: before.status, assignedToId: before.assignedToId },
        { status: concern.status, assignedToId: concern.assignedToId },
      );
      const isStatusChange = before.status !== concern.status;
      await recordAudit({
        projectId: concern.projectId,
        userId: session.user.id,
        action: isStatusChange ? "STATUS_CHANGE" : "UPDATE",
        entityType: "Concern",
        entityId: concern.id,
        summary:
          diff.summary ||
          (isStatusChange ? `Concern → ${concern.status}` : "Concern updated"),
        changes: diff.changes,
      });
    }
    return NextResponse.json({ concern });
  } catch (e) {
    return handleApiError(e, "PATCH /api/concerns/:id");
  }
}
