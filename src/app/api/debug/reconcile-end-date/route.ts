// One-shot: reconcile Project.endDate to the schedule's latest baseline
// handover, so the Total Delay hero stops reporting a 500+-day gap
// between hand-set project end and imported MSP schedule. Admin-only.
// Removed after Shraddha confirms the hero reads 0 days.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canCreateProject } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "planner/admin only" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const dryRun = searchParams.get("dryRun") === "1";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, endDate: true },
  });
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // Compute latest villa handover-milestone baseline finish. Uses the same
  // "last milestone in section order" rule that the rollup uses — so the
  // number we set matches what rollup.projectedEnd is driven from.
  const villaMilestones = await prisma.villaMilestone.findMany({
    where: { villa: { projectId } },
    select: {
      villaId: true,
      baselineFinish: true,
      projectedFinish: true,
      section: { select: { orderIndex: true } },
    },
  });

  // Group by villa, pick each villa's highest-order milestone, then take the
  // max baselineFinish (or projectedFinish if baseline null) across villas.
  const lastByVilla = new Map<string, { finish: Date | null; order: number }>();
  for (const vm of villaMilestones) {
    const finish = vm.baselineFinish ?? vm.projectedFinish;
    if (!finish) continue;
    const cur = lastByVilla.get(vm.villaId);
    if (!cur || vm.section.orderIndex > cur.order) {
      lastByVilla.set(vm.villaId, { finish, order: vm.section.orderIndex });
    }
  }
  const latestFinish = [...lastByVilla.values()].reduce<Date | null>((max, v) => {
    if (!v.finish) return max;
    return !max || v.finish > max ? v.finish : max;
  }, null);

  if (!latestFinish) {
    return NextResponse.json({ error: "no schedule data found" }, { status: 400 });
  }

  const before = project.endDate?.toISOString().slice(0, 10) ?? null;
  const after = latestFinish.toISOString().slice(0, 10);

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      project: { id: project.id, name: project.name },
      before,
      after,
      villasCounted: lastByVilla.size,
      wouldChange: before !== after,
    });
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { endDate: latestFinish },
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: projectId,
    summary: `Reconciled Project.endDate ${before} → ${after} to match schedule's latest villa handover baseline (villas counted: ${lastByVilla.size})`,
  });

  return NextResponse.json({
    ok: true,
    project: { id: project.id, name: project.name },
    before,
    after,
    villasCounted: lastByVilla.size,
  });
}
