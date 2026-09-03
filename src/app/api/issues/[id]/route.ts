import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview, isAdmin } from "@/lib/roles";
import { canAccessScopedRow } from "@/lib/modules";
import { z } from "zod";
import { recordAudit, diffSummary } from "@/lib/audit";
import { assignmentEmail, sendEmail } from "@/lib/email";
import { checkConflict } from "@/lib/optimisticLock";
import { parseBody } from "@/lib/parseBody";

const PatchIssueSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";


export async function PATCH(req: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchIssueSchema);
  if (!parsed.ok) return parsed.response;
  const { status, assignedToId, expectedUpdatedAt } = parsed.data;

  // Status changes (OPEN → RESOLVED, etc.) and reassignment are reviewer-only.
  if ((status !== undefined || assignedToId !== undefined) && !canReview(session.user.role)) {
    return forbidden();
  }

  const data: { status?: string; assignedToId?: string | null } = {};
  if (status !== undefined) data.status = status;
  if (assignedToId !== undefined) {
    if (assignedToId === null || assignedToId === "") {
      data.assignedToId = null;
    } else {
      const user = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true, active: true },
      });
      if (!user) return badRequest("Assignee not found");
      // Refuse to assign to a deactivated user — the snag would land on
      // /my-actions for an account that can't sign in to resolve it.
      if (!user.active) return badRequest("Cannot assign to a deactivated user.");
      data.assignedToId = assignedToId;
    }
  }

  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const before = await prisma.issue.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, assignedToId: true, updatedAt: true, module: true },
    });
    // findUnique is soft-delete filtered, so a null here means the snag is
    // missing or trashed — don't silently mutate it.
    if (!before) return notFound();
    // Module gate — a QAQC-scoped contractor cannot resolve or reassign a
    // SAFETY snag, and no scoped contractor can touch a general (module=null)
    // snag. Full-access internal users always pass this check.
    if (!canAccessScopedRow(session.user.modules, before.module)) return forbidden();
    // Optimistic-lock guard — reject if someone else edited between the
    // client's read and this write. No-op when the client didn't send
    // expectedUpdatedAt (backward compat during rollout).
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
      assignedToId: before.assignedToId,
    });
    if (!conflict.ok) return conflict.response!;
    const issue = await prisma.issue.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });

    // Assignment email — silent no-op when the assignee has no email or
    // RESEND_API_KEY isn't set on the deploy.
    if (
      issue.assignedToId &&
      issue.assignedToId !== before.assignedToId &&
      issue.assignedTo?.email
    ) {
      const desc = (await prisma.issue.findUnique({ where: { id }, select: { description: true } }))?.description ?? "Snag";
      const title = desc.length > 80 ? desc.slice(0, 80) + "…" : desc;
      await sendEmail(
        assignmentEmail({
          to: issue.assignedTo.email,
          assigneeName: issue.assignedTo.name,
          itemType: "Issue",
          itemTitle: title,
          itemUrl: `${SIDDHI_BASE_URL}/projects/${issue.projectId}/my-actions`,
          raisedByName: issue.createdBy.name,
        }),
      );
    }
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

/** Soft-delete an issue (snag). Creator or admin only. Restorable. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const existing = await prisma.issue.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, projectId: true, description: true, createdById: true, module: true },
  });
  if (!existing) return notFound();
  // Module gate before the ownership check so a scoped contractor can't
  // even confirm the existence of a snag outside their module.
  if (!canAccessScopedRow(session.user.modules, existing.module)) return forbidden();
  if (existing.createdById !== session.user.id && !isAdmin(session.user.role)) return forbidden();

  try {
    await prisma.issue.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "Issue",
      entityId: id,
      summary: `Snag moved to trash: ${existing.description.slice(0, 60)}${existing.description.length > 60 ? "…" : ""}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/issues/:id");
  }
}
