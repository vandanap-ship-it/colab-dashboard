import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { INSPECTION_TEMPLATES } from "../../../../../prisma/inspection-templates-data";

/**
 * Idempotently seed/refresh the curated White Lotus inspection templates.
 * Admin-only. Upserts by code; for each template it replaces the item set so
 * re-running always converges to the data file. Safe to call repeatedly.
 *
 *   GET  → list what's currently seeded
 *   POST → apply the seed
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const templates = await prisma.inspectionTemplate.findMany({
    orderBy: { orderIndex: "asc" },
    select: { code: true, name: true, module: true, _count: { select: { items: true } } },
  });
  return NextResponse.json({
    seeded: templates.map((t) => ({
      code: t.code,
      name: t.name,
      module: t.module,
      items: t._count.items,
    })),
    availableInDataFile: INSPECTION_TEMPLATES.length,
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results: string[] = [];
  try {
    for (const t of INSPECTION_TEMPLATES) {
      await prisma.$transaction(async (tx) => {
        const tpl = await tx.inspectionTemplate.upsert({
          where: { code: t.code },
          update: { name: t.name, activity: t.activity ?? null, module: t.module ?? null, orderIndex: t.orderIndex, active: true },
          create: { code: t.code, name: t.name, activity: t.activity ?? null, module: t.module ?? null, orderIndex: t.orderIndex },
        });
        // Replace the item set so the data file is the source of truth.
        await tx.inspectionTemplateItem.deleteMany({ where: { templateId: tpl.id } });
        await tx.inspectionTemplateItem.createMany({
          data: t.items.map((i) => ({
            templateId: tpl.id,
            seq: i.seq,
            section: i.section ?? null,
            description: i.description,
          })),
        });
      });
      results.push(`${t.code} (${t.items.length} items)`);
    }
    return NextResponse.json({ ok: true, seeded: results });
  } catch (e) {
    console.error("[POST /api/admin/seed-inspection-templates]", e);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
