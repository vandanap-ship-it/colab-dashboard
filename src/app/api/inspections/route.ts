import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, primaryModuleFor, isScopedUser, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody } from "@/lib/parseBody";

const PostInspectionSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  title: z.string().min(3).max(200),
  items: z.array(
    z.object({
      label: z.string().max(300).optional(),
      passed: z.union([z.boolean(), z.null()]).optional(),
      notes: z.string().max(500).optional(),
    }),
  ).max(100).optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const STATUSES = new Set(["IN_REVIEW", "PASSED", "REJECTED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const filledById = searchParams.get("filledById");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string; filledById?: string; module?: string; deletedAt: null } = { projectId, deletedAt: null };
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

  const parsed = await parseBody(req, PostInspectionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, wbsNodeId, title, items, photoUrls } = body;
  const t = title.trim();

  // Refuse the submission if any non-empty item has an unset pass/fail.
  // Pre-Jun-2026 the server coerced `!!i.passed` so a missing value silently
  // became "passed", which let engineers submit clean-looking inspections
  // without actually ticking each row. That was a real safety-record risk.
  const candidateItems = Array.isArray(items) ? items : [];
  const itemsClean: Array<{ label: string; passed: boolean; notes: string | null; orderIndex: number }> = [];
  for (let idx = 0; idx < candidateItems.length; idx++) {
    const i = candidateItems[idx];
    const label = (i.label ?? "").trim();
    if (label.length === 0) continue;
    if (typeof i.passed !== "boolean") {
      return NextResponse.json(
        { error: `Item "${label}" was not marked pass or fail.` },
        { status: 400 },
      );
    }
    itemsClean.push({
      label,
      passed: i.passed,
      notes: i.notes?.trim() || null,
      orderIndex: idx,
    });
  }
  if (itemsClean.length === 0) return NextResponse.json({ error: "At least one checklist item required" }, { status: 400 });

  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 8) : [];
  const moduleTag = primaryModuleFor(session.user.modules);
  const idempotencyKey = readIdempotencyKey(body);
  const inspectionInclude = {
    filledBy: { select: { id: true, name: true } },
    reviewedBy: { select: { id: true, name: true } },
    wbsNode: { select: { id: true, name: true, taskCode: true } },
    items: { orderBy: { orderIndex: "asc" as const } },
    photos: true,
  } as const;

  const { record: inspection, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.inspection.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: inspectionInclude }),
    () =>
      prisma.inspection.create({
        data: {
          projectId,
          wbsNodeId: wbsNodeId || null,
          title: t,
          module: moduleTag,
          filledById: session.user.id,
          idempotencyKey,
          items: { create: itemsClean },
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: inspectionInclude,
      }),
  );

  if (!duplicate) {
    const passedCount = itemsClean.filter((i) => i.passed).length;
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Inspection",
      entityId: inspection.id,
      summary: `Inspection submitted: "${t}" (${passedCount}/${itemsClean.length} passed)`,
    });
  }

  return NextResponse.json({ inspection }, { status: duplicate ? 200 : 201 });
}
