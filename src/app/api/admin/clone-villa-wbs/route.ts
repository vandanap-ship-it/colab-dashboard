import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

// One-shot: clone a template villa's VillaMilestones + WBSNodes onto every
// target villa that has ZERO wbsNodes. Progress fields (actualStart /
// actualFinish / pctComplete / delayReason) are reset — only the structural
// baseline gets copied. Idempotent: villas that already have any wbsNodes
// are skipped.
//
//   POST /api/admin/clone-villa-wbs
//     body: { projectId, templateVillaNumber, targetVillaNumbers: number[] }

export async function POST(req: Request) {
  try {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null) as {
    projectId?: string;
    templateVillaNumber?: number;
    targetVillaNumbers?: number[];
  } | null;
  if (!body?.projectId || typeof body.templateVillaNumber !== "number" || !Array.isArray(body.targetVillaNumbers)) {
    return NextResponse.json({ error: "projectId, templateVillaNumber, targetVillaNumbers required" }, { status: 400 });
  }

  const { projectId, templateVillaNumber, targetVillaNumbers } = body;

  const template = await prisma.villa.findFirst({
    where: { projectId, number: templateVillaNumber },
    select: { id: true, number: true },
  });
  if (!template) {
    return NextResponse.json({ error: `Template villa V${templateVillaNumber} not found` }, { status: 404 });
  }

  const templateMilestones = await prisma.villaMilestone.findMany({
    where: { villaId: template.id },
    select: {
      id: true,
      sectionId: true,
      baselineStart: true,
      baselineFinish: true,
      pctComplete: true,
    },
  });
  const templateWbs = await prisma.wBSNode.findMany({
    where: { projectId, villaId: template.id },
    select: {
      id: true,
      parentId: true,
      taskCode: true,
      name: true,
      level: true,
      orderIndex: true,
      baselineStart: true,
      baselineFinish: true,
      category: true,
      predecessorsRaw: true,
      totalQuantity: true,
      unit: true,
      contractorId: true,
      sectionId: true,
      villaMilestoneId: true,
      isSubMilestone: true,
    },
  });

  if (templateWbs.length === 0) {
    return NextResponse.json({ error: `Template villa V${templateVillaNumber} has no wbsNodes` }, { status: 400 });
  }

  const targets = await prisma.villa.findMany({
    where: { projectId, number: { in: targetVillaNumbers } },
    select: { id: true, number: true },
  });

  const results: Array<{ villaNumber: number; villaId: string; skipped: boolean; reason?: string; milestonesCreated?: number; wbsNodesCreated?: number }> = [];

  for (const target of targets) {
    const existingCount = await prisma.wBSNode.count({ where: { projectId, villaId: target.id } });
    if (existingCount > 0) {
      results.push({ villaNumber: target.number, villaId: target.id, skipped: true, reason: `already has ${existingCount} wbsNodes` });
      continue;
    }

    // 1. Upsert the villa's milestones — one per template section. Some target
    //    villas already have milestones auto-seeded by MSP; skip-or-reuse them.
    const oldToNewMilestone = new Map<string, string>();
    for (const tm of templateMilestones) {
      const newMs = await prisma.villaMilestone.upsert({
        where: { villaId_sectionId: { villaId: target.id, sectionId: tm.sectionId } },
        create: {
          villaId: target.id,
          sectionId: tm.sectionId,
          baselineStart: tm.baselineStart,
          baselineFinish: tm.baselineFinish,
          pctComplete: 0,
        },
        update: {}, // keep whatever's there
        select: { id: true },
      });
      oldToNewMilestone.set(tm.id, newMs.id);
    }

    // 2. Two-pass wbsNode create: pass 1 creates all rows without parentId,
    //    pass 2 sets parentId using the old→new map.
    const oldToNewWbs = new Map<string, string>();
    for (const w of templateWbs) {
      const newVmId = w.villaMilestoneId ? oldToNewMilestone.get(w.villaMilestoneId) ?? null : null;
      const created = await prisma.wBSNode.create({
        data: {
          projectId,
          taskCode: w.taskCode,
          name: w.name,
          level: w.level,
          orderIndex: w.orderIndex,
          baselineStart: w.baselineStart,
          baselineFinish: w.baselineFinish,
          category: w.category,
          predecessorsRaw: w.predecessorsRaw,
          totalQuantity: w.totalQuantity,
          unit: w.unit,
          contractorId: w.contractorId,
          villaId: target.id,
          sectionId: w.sectionId,
          villaMilestoneId: newVmId,
          isSubMilestone: w.isSubMilestone,
        },
        select: { id: true },
      });
      oldToNewWbs.set(w.id, created.id);
    }
    // Pass 2: fix parentId
    for (const w of templateWbs) {
      if (!w.parentId) continue;
      const newId = oldToNewWbs.get(w.id);
      const newParentId = oldToNewWbs.get(w.parentId);
      if (!newId || !newParentId) continue;
      await prisma.wBSNode.update({
        where: { id: newId },
        data: { parentId: newParentId },
      });
    }

    results.push({
      villaNumber: target.number,
      villaId: target.id,
      skipped: false,
      milestonesCreated: templateMilestones.length,
      wbsNodesCreated: templateWbs.length,
    });
  }

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "WBSNode",
    entityId: template.id,
    summary: `Clone WBS from V${templateVillaNumber} → ${targetVillaNumbers.join(",")}`,
    changes: { template: templateVillaNumber, targets: targetVillaNumbers, results },
  });

  return NextResponse.json({ ok: true, template: templateVillaNumber, results });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("clone-villa-wbs failed", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
