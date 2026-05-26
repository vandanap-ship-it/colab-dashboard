import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import { recordAudit, diffSummary } from "@/lib/audit";
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
    const before = await prisma.hindrance.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, daysImpact: true },
    });
    const hindrance = await prisma.hindrance.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true } },
        photos: true,
      },
    });
    if (before) {
      const diff = diffSummary(
        { status: before.status, daysImpact: before.daysImpact },
        { status: hindrance.status, daysImpact: hindrance.daysImpact },
      );
      const isStatusChange = before.status !== hindrance.status;
      await recordAudit({
        projectId: hindrance.projectId,
        userId: session.user.id,
        action: isStatusChange ? "STATUS_CHANGE" : "UPDATE",
        entityType: "Hindrance",
        entityId: hindrance.id,
        summary:
          diff.summary ||
          (isStatusChange ? `Hindrance → ${hindrance.status}` : "Hindrance updated"),
        changes: diff.changes,
      });
    }
    return NextResponse.json({ hindrance });
  } catch (e) {
    return handleApiError(e, "PATCH /api/hindrances/:id");
  }
}
