import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

const STATUSES = new Set(["IN_REVIEW", "PASSED", "REJECTED"]);

export async function PATCH(req: Request, ctx: RouteContext<"/api/inspections/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  if (!canReview(session.user.role)) {
    return forbidden("Only planners can review inspections");
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const { status, rejectionReason } = (body ?? {}) as {
    status?: string;
    rejectionReason?: string;
  };
  if (!status || !STATUSES.has(status)) {
    return badRequest("Invalid status");
  }

  try {
    const before = await prisma.inspection.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, title: true },
    });
    if (!before) return notFound();
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
