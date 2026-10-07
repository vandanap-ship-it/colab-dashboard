import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";
import { recordAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push";
import { isOwnUploadUrl } from "@/lib/upload";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";
import { parseSnapshot } from "@/lib/registers";

/**
 * One register sign-off.
 *
 * GET   → the frozen snapshot + decision trail.
 * PATCH { status: APPROVED | REJECTED, rejectionReason?, expectedUpdatedAt }
 *         → the approver's decision. canReview + module + not the
 *           preparer, PENDING only. Same gate as Safety Induction / HSE
 *           checklist review — Girish R on Amanvana.
 * PATCH { signedPaperUrl }
 *         → attach (or clear) a photo of the wet-signed paper sheet.
 *           Preparer or a reviewer, any status. Transition-period aid.
 */

const PatchSchema = z.union([
  z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    rejectionReason: z.string().max(2000).nullable().optional(),
    expectedUpdatedAt: z.string().optional(),
  }),
  z.object({
    signedPaperUrl: z.string().max(2000).nullable(),
  }),
]);

type Ctx = { params: Promise<{ id: string }> };

const include = {
  preparedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  register: { select: { projectId: true, type: { select: { code: true, shortName: true, module: true } } } },
} as const;

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id } = await ctx.params;
    const sub = await prisma.registerSubmission.findUnique({ where: { id }, include });
    if (!sub) return notFound();
    if (!canAccessModule(session.user.modules, sub.register.type.module as ModuleKey)) return forbidden();
    return NextResponse.json({ submission: { ...sub, snapshot: parseSnapshot(sub.snapshot) } });
  } catch (e) {
    return handleApiError(e, "register-submissions/[id] GET");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id } = await ctx.params;
    const before = await prisma.registerSubmission.findUnique({ where: { id }, include });
    if (!before) return notFound();
    const { type, projectId } = before.register;
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) return forbidden();

    const parsed = await parseBody(req, PatchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    if ("signedPaperUrl" in body) {
      const isPreparer = before.preparedById === session.user.id;
      if (!isPreparer && !canReview(session.user.role)) return forbidden();
      if (body.signedPaperUrl && !isOwnUploadUrl(body.signedPaperUrl)) {
        return badRequest("Upload the photo through Siddhi first.");
      }
      const updated = await prisma.registerSubmission.update({
        where: { id },
        data: { signedPaperUrl: body.signedPaperUrl },
        include,
      });
      await recordAudit({
        projectId,
        userId: session.user.id,
        action: "UPDATE",
        entityType: "RegisterSubmission",
        entityId: id,
        summary: `${type.shortName} sign-off ${before.displayId}: signed paper photo ${body.signedPaperUrl ? "attached" : "removed"}`,
      });
      return NextResponse.json({ submission: { ...updated, snapshot: parseSnapshot(updated.snapshot) } });
    }

    if (!canReview(session.user.role)) {
      return forbidden("Only the designated approver can sign off registers.");
    }
    if (before.preparedById === session.user.id) {
      return forbidden("You can't sign off a register you submitted yourself.");
    }
    if (before.status !== "PENDING") {
      return badRequest(`${before.displayId} is already ${before.status.toLowerCase()}.`);
    }
    const reason = body.rejectionReason?.trim() || null;
    if (body.status === "REJECTED" && (!reason || reason.length < 3)) {
      return badRequest("Say what needs fixing before rejecting.");
    }
    const conflict = checkConflict(body.expectedUpdatedAt, before.updatedAt, {
      id: before.id,
      status: before.status,
    });
    if (!conflict.ok) return conflict.response!;

    const now = new Date();
    // Guard the status in the write itself so two approvers tapping at
    // once can't both win.
    const res = await prisma.registerSubmission.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: body.status,
        approvedById: body.status === "APPROVED" ? session.user.id : null,
        approvedAt: body.status === "APPROVED" ? now : null,
        rejectedById: body.status === "REJECTED" ? session.user.id : null,
        rejectedAt: body.status === "REJECTED" ? now : null,
        rejectionReason: body.status === "REJECTED" ? reason : null,
      },
    });
    if (res.count === 0) return badRequest(`${before.displayId} was decided by someone else just now.`);
    const updated = await prisma.registerSubmission.findUniqueOrThrow({ where: { id }, include });

    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "STATUS_CHANGE",
      entityType: "RegisterSubmission",
      entityId: id,
      summary: `${type.shortName} sign-off ${before.displayId} → ${body.status}${reason ? ` (${reason.slice(0, 60)})` : ""}`,
    });

    const reviewer = updated.approvedBy?.name ?? updated.rejectedBy?.name ?? "the approver";
    await sendPushToUser(before.preparedById, {
      title:
        body.status === "APPROVED"
          ? `${type.shortName} register signed off`
          : `${type.shortName} register sent back`,
      body:
        body.status === "APPROVED"
          ? `${before.displayId} approved by ${reviewer}.`
          : `${before.displayId} rejected by ${reviewer}. ${reason ? `Reason: ${reason.slice(0, 100)}` : ""}`.trim(),
      url: `/mobile/${projectId}/registers/${type.code}/submissions/${id}`,
      tag: `register-sub-${id}`,
    });

    return NextResponse.json({ submission: { ...updated, snapshot: parseSnapshot(updated.snapshot) } });
  } catch (e) {
    return handleApiError(e, "register-submissions/[id] PATCH");
  }
}
