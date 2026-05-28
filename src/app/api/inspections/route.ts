import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, primaryModuleFor, isScopedUser, MODULES } from "@/lib/modules";

const STATUSES = new Set(["IN_REVIEW", "PASSED", "REJECTED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const filledById = searchParams.get("filledById");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string; filledById?: string; module?: string } = { projectId };
  if (status && STATUSES.has(status)) where.status = status;
  if (filledById) where.filledById = filledById;
  // Scoped contractors only see inspections tagged to their module.
  if (isScopedUser(session.user.modules)) {
    const m = primaryModuleFor(session.user.modules);
    if (m) where.module = m;
  }

  const inspections = await prisma.inspection.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      filledBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      items: { orderBy: { orderIndex: "asc" } },
      photos: { select: { id: true, url: true } },
    },
  });

  const grouped = await prisma.inspection.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { IN_REVIEW: 0, PASSED: 0, REJECTED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ inspections, counts });
}

type ItemInput = { label?: string; passed?: boolean; notes?: string };

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Inspections belong to QAQC or SAFETY.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Your account doesn't have access to inspections." }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, wbsNodeId, title, items, photoUrls } = (body ?? {}) as {
    projectId?: string;
    wbsNodeId?: string;
    title?: string;
    items?: ItemInput[];
    photoUrls?: string[];
  };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const t = (title ?? "").trim();
  if (t.length < 3) return NextResponse.json({ error: "Title too short" }, { status: 400 });

  const itemsClean = Array.isArray(items)
    ? items
        .map((i, idx) => ({
          label: (i.label ?? "").trim(),
          passed: !!i.passed,
          notes: i.notes?.trim() || null,
          orderIndex: idx,
        }))
        .filter((i) => i.label.length > 0)
    : [];
  if (itemsClean.length === 0) return NextResponse.json({ error: "At least one checklist item required" }, { status: 400 });

  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 8) : [];
  const moduleTag = primaryModuleFor(session.user.modules);

  const inspection = await prisma.inspection.create({
    data: {
      projectId,
      wbsNodeId: wbsNodeId || null,
      title: t,
      module: moduleTag,
      filledById: session.user.id,
      items: { create: itemsClean },
      photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
    },
    include: {
      filledBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      items: { orderBy: { orderIndex: "asc" } },
      photos: true,
    },
  });

  const passedCount = itemsClean.filter((i) => i.passed).length;
  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "Inspection",
    entityId: inspection.id,
    summary: `Inspection submitted: "${t}" (${passedCount}/${itemsClean.length} passed)`,
  });

  return NextResponse.json({ inspection }, { status: 201 });
}
