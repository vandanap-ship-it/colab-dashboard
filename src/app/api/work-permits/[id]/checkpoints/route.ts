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
import { narrowCheckpoints, applyReviewerReply } from "@/lib/permitChecklist";

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
        displayId: true,
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
    // the checklist is a historical record. SUSPENDED is treated as a
    // paused-mid-review state, so approvers can still annotate.
    if (permit.status !== "PENDING" && permit.status !== "SUSPENDED") {
      return badRequest("Checklist replies are only editable while the permit is pending or suspended.");
    }

    // Concurrent-write safety: two reviewers editing DIFFERENT indices
    // simultaneously would each read the same array and one would clobber
    // the other's write. Wrap the read + merge + write in a transaction
    // that re-reads the latest checklistResponses inside the tx before
    // computing the merge, so the write always applies on top of the
    // freshest server state.
    //
    // We also re-read `status` inside the tx — if a peer approver approved
    // or rejected the permit between the pre-check above and this tx,
    // the reply should NOT sneak in after the decision. The audit trail
    // must not show a reviewer replying to a checkpoint *after* the
    // permit was already decided.
    let mergedForResponse: ReturnType<typeof applyReviewerReply> = null;
    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.workPermit.findUnique({
          where: { id },
          select: { checklistResponses: true, status: true },
        });
        if (!fresh) {
          throw new RangeError(`GONE`);
        }
        if (fresh.status !== "PENDING" && fresh.status !== "SUSPENDED") {
          throw new RangeError(`STATUS_CHANGED:${fresh.status}`);
        }
        const freshRows = narrowCheckpoints(fresh.checklistResponses);
        const nextRows = applyReviewerReply(freshRows, index, { reviewerNote, reviewerPhotoUrl });
        if (nextRows === null) {
          throw new RangeError(`OUT_OF_RANGE:${freshRows.length}`);
        }
        await tx.workPermit.update({
          where: { id },
          data: { checklistResponses: nextRows },
        });
        mergedForResponse = nextRows;
      });
    } catch (e) {
      if (e instanceof RangeError) {
        if (e.message.startsWith("OUT_OF_RANGE:")) {
          const size = e.message.split(":")[1] ?? "0";
          return badRequest(`Checkpoint index out of range (permit has ${size} rows).`);
        }
        if (e.message.startsWith("STATUS_CHANGED:")) {
          const status = (e.message.split(":")[1] ?? "").toLowerCase();
          return badRequest(
            `This permit is now ${status} — checklist replies are only editable while it's pending or suspended. Reload the permit to see the latest state.`,
          );
        }
        if (e.message === "GONE") {
          return notFound();
        }
      }
      throw e;
    }
    const nextRows = mergedForResponse!;

    await recordAudit({
      projectId: permit.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "WorkPermit",
      entityId: id,
      summary: `Reviewer replied on checkpoint #${index + 1}${permit.displayId ? ` of ${permit.displayId}` : ""}${reviewerNote ? `: "${reviewerNote.slice(0, 60)}"` : ""}${reviewerPhotoUrl ? " (with photo)" : ""}`,
    });

    return NextResponse.json({ ok: true, index, checkpoint: nextRows[index] });
  } catch (e) {
    return handleApiError(e, "work-permits/[id]/checkpoints");
  }
}
