import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import {
  badRequest,
  forbidden,
  handleApiError,
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
    return NextResponse.json({ inspection });
  } catch (e) {
    return handleApiError(e, "PATCH /api/inspections/:id");
  }
}
