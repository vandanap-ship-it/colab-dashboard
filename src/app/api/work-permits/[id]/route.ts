import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, hasFullAccess, MODULES } from "@/lib/modules";
import { isAdmin } from "@/lib/roles";
import { checkConflict } from "@/lib/optimisticLock";
import { parseBody } from "@/lib/parseBody";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";
import { allowedWorkPermitTransition, isApprover, type WorkPermitStatus } from "@/lib/workPermit";

const PatchWorkPermitSchema = z.object({
  // Only status changes are supported on this endpoint. Editing an existing
  // permit's content (times, location, etc.) isn't a real workflow — you
  // reject and re-raise instead. Keeps the API surface small.
  status: z.enum(["APPROVED", "REJECTED", "CLOSED"]),
  rejectionReason: z.string().max(1000).optional(),
  expectedUpdatedAt: z.string().optional(),
});

const workPermitInclude = {
  requester: { select: { id: true, name: true, username: true, email: true } },
  approver: { select: { id: true, name: true, username: true } },
  closer: { select: { id: true, name: true, username: true } },
  contractor: { select: { id: true, name: true } },
  wbsNode: { select: { id: true, name: true, taskCode: true } },
  photos: { select: { id: true, url: true } },
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();
    const { id } = await ctx.params;
    const workPermit = await prisma.workPermit.findUnique({
      where: { id },
      include: workPermitInclude,
    });
    if (!workPermit) return notFound();
    return NextResponse.json({ workPermit });
  } catch (e) {
    return handleApiError(e, "work-permits/[id]");
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();

    const { id } = await ctx.params;
    const existing = await prisma.workPermit.findUnique({ where: { id } });
    if (!existing) return notFound();

    const parsed = await parseBody(req, PatchWorkPermitSchema);
    if (!parsed.ok) return parsed.response;
    const { status: newStatus, rejectionReason, expectedUpdatedAt } = parsed.data;

    const conflict = checkConflict(expectedUpdatedAt, existing.updatedAt, {
      id: existing.id, status: existing.status, title: existing.title,
    });
    if (!conflict.ok) return conflict.response!;

    const currentStatus = existing.status as WorkPermitStatus;
    const kind = allowedWorkPermitTransition(currentStatus, newStatus);
    if (!kind) {
      return badRequest(`Cannot move a work permit from ${currentStatus} to ${newStatus}`);
    }

    // Per-action authorization. Admin bypasses all these — a full-access
    // internal admin can rescue any permit from any state.
    const admin = isAdmin(session.user.role);
    if (kind === "approve" || kind === "reject") {
      // Only listed approvers can approve or reject a pending permit.
      // Requesters cannot approve their own permits — that's the whole
      // reason approval exists.
      if (!admin && !isApprover(existing.approverIds, session.user.id)) {
        return forbidden("Only a listed approver can approve or reject this permit.");
      }
    }
    if (kind === "close") {
      // Either the approver who approved it, or the original requester,
      // or an admin can close a permit. In practice the requester closes
      // at end of day.
      const allowedToClose =
        admin ||
        session.user.id === existing.approvedById ||
        session.user.id === existing.requesterId ||
        isApprover(existing.approverIds, session.user.id);
      if (!allowedToClose) {
        return forbidden("Only the approver or the requester can close this permit.");
      }
    }

    // Belt-and-suspenders: reject requires a reason. UI should enforce this,
    // but do not trust the client.
    if (kind === "reject" && (!rejectionReason || rejectionReason.trim().length === 0)) {
      return badRequest("Rejection reason is required.");
    }

    // Only internal (full-access) staff can act on this — external scoped
    // users are barred from being approvers even if their module happens
    // to include PERMIT. Prevents "vendor approves their own work permit"
    // failure mode.
    if (!hasFullAccess(session.user.modules) && (kind === "approve" || kind === "reject")) {
      return forbidden("Only internal staff can approve or reject work permits.");
    }

    const now = new Date();
    const data: Record<string, unknown> = { status: newStatus };
    if (kind === "approve") {
      data.approvedById = session.user.id;
      data.approvedAt = now;
    } else if (kind === "reject") {
      data.rejectedById = session.user.id;
      data.rejectedAt = now;
      data.rejectionReason = rejectionReason?.trim() || null;
    } else if (kind === "close") {
      data.closedById = session.user.id;
      data.closedAt = now;
    }

    const updated = await prisma.workPermit.update({
      where: { id },
      data,
      include: workPermitInclude,
    });

    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "WorkPermit",
      entityId: id,
      summary:
        `${existing.type} "${existing.title.slice(0, 60)}" → ${newStatus}` +
        (kind === "reject" && rejectionReason ? ` (${rejectionReason.slice(0, 80)})` : ""),
    });

    return NextResponse.json({ workPermit: updated });
  } catch (e) {
    return handleApiError(e, "PATCH /api/work-permits/:id");
  }
}

/**
 * Soft-delete a work permit. Requester or admin only. Restorable via the
 * standard trash flow.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();

    const { id } = await ctx.params;
    const existing = await prisma.workPermit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, type: true, title: true, requesterId: true, status: true },
    });
    if (!existing) return notFound();
    if (existing.requesterId !== session.user.id && !isAdmin(session.user.role)) return forbidden();
    // Never delete an APPROVED-but-not-closed permit — that would leave
    // an in-progress work authorization dangling. Reject or close it first.
    if (existing.status === "APPROVED") {
      return badRequest("Approved permits must be closed or rejected before delete.");
    }

    await prisma.workPermit.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "WorkPermit",
      entityId: id,
      summary: `Work permit trashed: ${existing.type} · ${existing.title.slice(0, 60)}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/work-permits/:id");
  }
}
