// TEMP diagnostic — dumps the villa-level rollup fields that feed the
// Dashboard hero (projectedEnd + handoverSlipDays) so we can see WHICH
// villa is contributing the "20 Mar 29" projected end vs the "0 days"
// total delay. Admin/staff-only. Removed after diagnosis.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getDashboardBag } from "@/lib/rollupServer";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canSeeDesktop(session.user.role)) {
    return NextResponse.json({ error: "staff only" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const [bag, project] = await Promise.all([
    getDashboardBag(projectId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { startDate: true, endDate: true, projectedEndDate: true, reraEndDate: true },
    }),
  ]);
  if (!bag) return NextResponse.json({ error: "no bag" }, { status: 404 });

  const villasFlat = bag.rollup.blocks.flatMap((b) =>
    b.villas.map((v) => ({
      block: b.code,
      villa: v.number,
      currentSection: v.currentSection,
      handoverSlipDays: v.handoverSlipDays,
      handoverProjected: v.handoverProjected?.toISOString() ?? null,
      lastMilestoneName: v.milestones.at(-1)?.section ?? null,
      lastMilestoneBaselineFinish: v.milestones.at(-1)?.baselineFinish?.toISOString() ?? null,
      lastMilestoneProjectedFinish: v.milestones.at(-1)?.projectedFinish?.toISOString() ?? null,
      lastMilestoneActualFinish: v.milestones.at(-1)?.actualFinish?.toISOString() ?? null,
      lastMilestoneDelayDays: v.milestones.at(-1)?.delayDays ?? null,
    })),
  );

  // Find the "worst" villa by handoverProjected — that's the one driving projectedEnd
  const withProjection = villasFlat.filter((v) => v.handoverProjected);
  const worst = withProjection.sort((a, b) => (b.handoverProjected! > a.handoverProjected! ? 1 : -1)).slice(0, 5);

  // Find villas with actual delay
  const delayed = villasFlat.filter((v) => v.handoverSlipDays > 0).sort((a, b) => b.handoverSlipDays - a.handoverSlipDays).slice(0, 5);

  return NextResponse.json({
    projectMeta: {
      startDate: project?.startDate?.toISOString() ?? null,
      endDate: project?.endDate?.toISOString() ?? null,
      projectedEndDate: project?.projectedEndDate?.toISOString() ?? null,
      reraEndDate: project?.reraEndDate?.toISOString() ?? null,
    },
    rollup: {
      handoverSlipDays: bag.rollup.handoverSlipDays,
      currentSlipDays: bag.rollup.currentSlipDays,
      projectedEnd: bag.rollup.projectedEnd?.toISOString() ?? null,
      percentComplete: bag.rollup.percentComplete,
      criticalBlocks: bag.rollup.criticalBlocks,
      criticalVillas: bag.rollup.criticalVillas,
      totalVillas: villasFlat.length,
      villasWithProjection: withProjection.length,
      villasWithSlip: delayed.length,
    },
    top5VillasByLatestHandoverProjection: worst,
    top5VillasByHandoverSlip: delayed,
  });
}
