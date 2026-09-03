import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import {
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";

const PatchInspectionSchema = z.object({
  status: z.enum(["IN_REVIEW", "PASSED", "REJECTED"]),
  rejectionReason: z.string().max(1000).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/inspections/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (!canReview(session.user.role)) {
    return forbidden("Only planners can review inspections");
  }

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchInspectionSchema);
  if (!parsed.ok) return parsed.response;
  const { status, rejectionReason, expectedUpdatedAt } = parsed.data;

  try {
    const before = await prisma.inspection.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, title: true, updatedAt: true },
    });
    if (!before) return notFound();
    const conflict = checkConflict(expectedUpdatedAt, before.updatedAt, {
      id: before.id, status: before.status, title: before.title,
    });
    if (!conflict.ok) return conflict.response!;
    const inspection = await prisma.inspection.update({
      where: { id },
      data: {
        status,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
        rejectionReason: status === "REJECTED" ? rejectionReason?.trim() || null : null,
      },
      include: {
        filledBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        items: { orderBy: { orderIndex: "asc" } },
        photos: true,
      },
    });
    {
      await recordAudit({
        projectId: inspection.projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "Inspection",
        entityId: inspection.id,
        summary: `Inspection "${before.title}" → ${status}${
          status === "REJECTED" && rejectionReason ? ` (${rejectionReason.slice(0, 60)})` : ""
        }`,
      });
    }
    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "PATCH /api/inspections/:id");
  }
}
