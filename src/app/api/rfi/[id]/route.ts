import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { recordAudit } from "@/lib/audit";
import { sendEmail, assignmentEmail } from "@/lib/email";
import {
  RFI_PRIORITIES,
  RFI_STATUSES,
  canTransition,
  formatRfiNumber,
  validateAnswer,
  type RfiStatus,
} from "@/lib/rfi";
import { parseBody, zDateString } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";

const PatchRfiSchema = z.object({
  assignedToId: z.string().min(1).nullable().optional(),
  answer: z.string().max(8000).optional(),
  status: z.enum(RFI_STATUSES).optional(),
  priority: z.enum(RFI_PRIORITIES).optional(),
  dueDate: zDateString.nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const RFI_INCLUDE = {
  raisedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  answeredBy: { select: { id: true, name: true } },
  wbsNode: { select: { id: true, name: true, taskCode: true } },
  photos: { select: { id: true, url: true } },
} as const;

const SIDDHI_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "https://siddhi-whitelotus.vercel.app";

export async function GET(_req: Request, ctx: RouteContext<"/api/rfi/[id]">) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.RFI)) return forbidden();

    const { id } = await ctx.params;
    const rfi = await prisma.rfi.findUnique({ where: { id }, include: RFI_INCLUDE });
    if (!rfi) return notFound();
    return NextResponse.json({ rfi });
  } catch (e) {
    return handleApiError(e, "rfi/[id]");
  }
}

/**
 * PATCH handles three distinct actions in one endpoint (matches the Concern
 * pattern already used in the app):
 *   - assign        → sets assignedToId, emails the new assignee
 *   - answer        → sets answer/answeredById/answeredAt, moves to ANSWERED
 *   - transition    → status change (ANSWERED→CLOSED, CLOSED→OPEN, etc.)
 *   - meta updates  → priority, dueDate
 * Multiple actions per request are allowed (e.g. answer + close in one call).
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/rfi/[id]">) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.RFI)) return forbidden();

    const { id } = await ctx.params;
    const existing = await prisma.rfi.findUnique({ where: { id }, include: RFI_INCLUDE });
    if (!existing) return notFound();

    const parsed = await parseBody(req, PatchRfiSchema);
    if (!parsed.ok) return parsed.response;
    const patch = parsed.data;
    const conflict = checkConflict(patch.expectedUpdatedAt, existing.updatedAt, {
      id: existing.id,
      status: existing.status,
      assignedToId: existing.assignedToId,
      priority: existing.priority,
    });
    if (!conflict.ok) return conflict.response!;

    // Build the update object incrementally + track what changed for the audit.
    const data: Record<string, unknown> = {};
    const changes: string[] = [];

    // Assignment
    if (patch.assignedToId !== undefined && patch.assignedToId !== existing.assignedToId) {
      data.assignedToId = patch.assignedToId || null;
      const before = existing.assignedTo?.name ?? "none";
      const afterUser = patch.assignedToId
        ? await prisma.user.findUnique({ where: { id: patch.assignedToId }, select: { name: true } })
        : null;
      changes.push(`assignedTo: ${before} → ${afterUser?.name ?? "none"}`);
    }

    // Priority
    if (patch.priority && patch.priority !== existing.priority) {
      if (!(RFI_PRIORITIES as readonly string[]).includes(patch.priority)) {
        return badRequest("Invalid priority");
      }
      data.priority = patch.priority;
      changes.push(`priority: ${existing.priority} → ${patch.priority}`);
    }

    // Due date
    if (patch.dueDate !== undefined) {
      const nextDue = patch.dueDate ? new Date(patch.dueDate) : null;
      if (patch.dueDate && isNaN(nextDue!.getTime())) return badRequest("Invalid dueDate");
      const before = existing.dueDate?.toISOString().slice(0, 10) ?? "none";
      const after = nextDue?.toISOString().slice(0, 10) ?? "none";
      if (before !== after) {
        data.dueDate = nextDue;
        changes.push(`dueDate: ${before} → ${after}`);
      }
    }

    // Answer — moves status to ANSWERED automatically
    if (patch.answer !== undefined) {
      const errs = validateAnswer(patch.answer);
      if (errs.length > 0) return badRequest(errs[0].message);
      data.answer = patch.answer.trim();
      data.answeredById = session.user.id;
      data.answeredAt = new Date();
      // Auto-transition to ANSWERED unless the caller sets a specific status.
      if (!patch.status && existing.status === "OPEN") {
        data.status = "ANSWERED";
        changes.push(`status: OPEN → ANSWERED (auto)`);
      }
      changes.push(`answered`);
    }

    // Explicit status transition
    if (patch.status && patch.status !== existing.status) {
      if (!(RFI_STATUSES as readonly string[]).includes(patch.status)) {
        return badRequest("Invalid status");
      }
      if (!canTransition(existing.status as RfiStatus, patch.status)) {
        return badRequest(`Illegal transition ${existing.status} → ${patch.status}`);
      }
      data.status = patch.status;
      changes.push(`status: ${existing.status} → ${patch.status}`);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ rfi: existing }); // no-op
    }

    const updated = await prisma.rfi.update({
      where: { id },
      data,
      include: RFI_INCLUDE,
    });

    await recordAudit({
      projectId: existing.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Rfi",
      entityId: id,
      summary: `${formatRfiNumber(existing.number)} · ${changes.join(", ")}`,
    });

    // Assignment email — fire-and-forget after the DB commit. Silent no-op
    // when the assignee has no email on file or RESEND_API_KEY isn't set.
    if (
      updated.assignedToId &&
      updated.assignedToId !== existing.assignedToId &&
      updated.assignedTo?.email
    ) {
      const url = `${SIDDHI_BASE_URL}/projects/${existing.projectId}/rfi/${id}`;
      await sendEmail(
        assignmentEmail({
          to: updated.assignedTo.email,
          assigneeName: updated.assignedTo.name,
          itemType: "RFI",
          itemTitle: `${formatRfiNumber(existing.number)} — ${existing.subject}`,
          itemUrl: url,
          raisedByName: existing.raisedBy.name,
          dueDate: updated.dueDate,
        }),
      );
    }

    return NextResponse.json({ rfi: updated });
  } catch (e) {
    return handleApiError(e, "rfi/[id]");
  }
}
