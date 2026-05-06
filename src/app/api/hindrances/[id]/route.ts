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

const STATUSES = new Set(["OPEN", "RESOLVED"]);

export async function PATCH(req: Request, ctx: RouteContext<"/api/hindrances/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const { status, daysImpact } = (body ?? {}) as { status?: string; daysImpact?: number };

  if (status === "RESOLVED" && !canReview(session.user.role)) {
    return forbidden();
  }

  const data: { status?: string; daysImpact?: number; resolvedDate?: Date | null } = {};
  if (status && STATUSES.has(status)) {
    data.status = status;
    if (status === "RESOLVED") data.resolvedDate = new Date();
    if (status === "OPEN") data.resolvedDate = null;
  }
  if (Number.isFinite(Number(daysImpact))) {
    data.daysImpact = Math.max(0, Math.floor(Number(daysImpact)));
  }
  if (Object.keys(data).length === 0) return badRequest("Nothing to update");

  try {
    const hindrance = await prisma.hindrance.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });
    return NextResponse.json({ hindrance });
  } catch (e) {
    return handleApiError(e, "PATCH /api/hindrances/:id");
  }
}
