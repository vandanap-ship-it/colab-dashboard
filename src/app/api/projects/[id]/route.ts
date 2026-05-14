import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

function parseDateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: { actualStartDate?: string | null; projectedEndDate?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: { actualStartDate?: Date | null; projectedEndDate?: Date | null } = {};
  const aStart = parseDateOrNull(body.actualStartDate);
  if (aStart !== undefined) data.actualStartDate = aStart;
  const pEnd = parseDateOrNull(body.projectedEndDate);
  if (pEnd !== undefined) data.projectedEndDate = pEnd;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update. Send actualStartDate and/or projectedEndDate." },
      { status: 400 },
    );
  }

  const updated = await prisma.project.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      actualStartDate: true,
      projectedEndDate: true,
    },
  });

  return NextResponse.json({ project: updated });
}
