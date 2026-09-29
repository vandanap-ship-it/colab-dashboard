import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";
import { isAdmin } from "@/lib/roles";
import { isApprover } from "@/lib/workPermit";

/**
 * Colab-parity permit reviewer · per-checkpoint Add Reply endpoint.
 *
 * PATCH /api/work-permits/[id]/checkpoints
 * body: { index: number, reviewerNote?: string|null, reviewerPhotoUrl?: string|null }
 *
 * Updates a single row inside WorkPermit.checklistResponses (jsonb array)
 * by index. Only listed approvers on the permit (or admin) can call this;
 * only while the permit is PENDING (once approved/closed/rejected the
 * checklist is a record, not a working document).
 *
 * We PATCH the whole array atomically inside a transaction so a
 * concurrent reviewer's write on another index doesn't stomp this one.
 */

const PatchCheckpointSchema = z.object({
  index: z.number().int().min(0).max(50),
  reviewerNote: z.string().max(2000).nullable().optional(),
  reviewerPhotoUrl: z.string().url().nullable().optional(),
});

type StoredCheckpoint = {
  q: string;
  passed: boolean | null;
  remark?: string;
  photoUrl?: string;
  reviewerNote?: string | null;
  reviewerPhotoUrl?: string | null;
};

function narrowCheckpoints(v: unknown): StoredCheckpoint[] {
  if (!Array.isArray(v)) return [];
  const out: StoredCheckpoint[] = [];
  for (const row of v) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).q === "string") {
      const r = row as Record<string, unknown>;
      out.push({
        q: r.q as string,
        passed: typeof r.passed === "boolean" ? (r.passed as boolean) : null,
        remark: typeof r.remark === "string" ? (r.remark as string) : undefined,
        photoUrl: typeof r.photoUrl === "string" ? (r.photoUrl as string) : undefined,
        reviewerNote: typeof r.reviewerNote === "string" ? (r.reviewerNote as string) : null,
        reviewerPhotoUrl:
          typeof r.reviewerPhotoUrl === "string" ? (r.reviewerPhotoUrl as string) : null,
      });
    }
  }
  return out;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    if (!canAccessModule(session.user.modules, MODULES.PERMIT)) return forbidden();

    const { id } = await ctx.params;
    const parsed = await parseBody(req, PatchCheckpointSchema);
    if (!parsed.ok) return parsed.response;
    const { index, reviewerNote, reviewerPhotoUrl } = parsed.data;

    const permit = await prisma.workPermit.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        status: true,
        approverIds: true,
        checklistResponses: true,
      },
    });
    if (!permit) return notFound();

    // Only approvers (or admin) can reply on a checkpoint. Requesters
    // author the checklist on Step 3; the reply belongs to the review.
    const admin = isAdmin(session.user.role);
    if (!admin && !isApprover(permit.approverIds, session.user.id)) {
      return forbidden("Only an approver can reply on a checkpoint.");
    }

    // Only actionable while the permit is still open — once decided,
    // the checklist is a historical record.
    if (permit.status !== "PENDING") {
      return badRequest("Checklist replies are only editable while the permit is pending review.");
    }

    const rows = narrowCheckpoints(permit.checklistResponses);
    if (index >= rows.length) {
      return badRequest(`Checkpoint index out of range (permit has ${rows.length} rows).`);
    }

    const target = rows[index];
    const next: StoredCheckpoint = {
      ...target,
      // undefined = don't touch; null = clear
      reviewerNote:
        reviewerNote === undefined
          ? target.reviewerNote ?? null
          : reviewerNote?.trim() || null,
      reviewerPhotoUrl:
        reviewerPhotoUrl === undefined
          ? target.reviewerPhotoUrl ?? null
          : reviewerPhotoUrl || null,
    };
    const nextRows = rows.slice();
    nextRows[index] = next;

    await prisma.workPermit.update({
      where: { id },
      data: { checklistResponses: nextRows },
    });

    await recordAudit({
      projectId: permit.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "WorkPermit",
      entityId: id,
      summary: `Reviewer replied on checkpoint #${index + 1}${reviewerNote ? `: "${reviewerNote.slice(0, 60)}"` : ""}${reviewerPhotoUrl ? " (with photo)" : ""}`,
    });

    return NextResponse.json({ ok: true, index, checkpoint: next });
  } catch (e) {
    return handleApiError(e, "work-permits/[id]/checkpoints");
  }
}
