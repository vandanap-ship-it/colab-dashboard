import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

// Diagnostic for the three known Weekly-Report parity gaps vs Shraddha's
// Python (build_wk23.py). No writes. Read-only, admin-only.
//
//   GET /api/admin/parity-check?projectId=<id>&date=YYYY-MM-DD
//
// Reports:
//   1. ColabActivity progressDate count + physicalProgress sums → §1 gap
//   2. Per-villa contractor mix for the "problem villas" (V50 etc.)
//   3. Per-milestone Progress_Date row count + VillaMilestone.actualStart
//      state for V06 / V07 / V08 Foundation (Aug 24-30 In-Progress delta)

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const dateStr = searchParams.get("date");
  if (!projectId || !dateStr) {
    return NextResponse.json({ error: "projectId and date required" }, { status: 400 });
  }
  const cutoff = new Date(dateStr + "T00:00:00Z");
  cutoff.setUTCHours(23, 59, 59, 999);

  // --- 1) ColabActivity summary ---
  const [totalRows, withProgressDate, plannedBy, actualBy] = await Promise.all([
    prisma.colabActivity.count({ where: { projectId } }),
    prisma.colabActivity.count({ where: { projectId, progressDate: { not: null } } }),
    prisma.colabActivity.aggregate({
      where: { projectId, plannedEnd: { lte: cutoff } },
      _sum: { physicalProgress: true },
    }),
    prisma.colabActivity.aggregate({
      where: { projectId, progressDate: { not: null, lte: cutoff } },
      _sum: { physicalProgress: true },
    }),
  ]);

  // --- 2) Per-villa contractor mix (V03, V17, V50, V47-49 sample) ---
  const probeNumbers = [3, 6, 7, 8, 17, 25, 47, 48, 49, 50];
  const probeVillas = await prisma.villa.findMany({
    where: { projectId, number: { in: probeNumbers } },
    select: { id: true, number: true },
  });
  const contractors = await prisma.contractor.findMany({
    where: { projectId }, select: { id: true, name: true },
  });
  const contractorName = new Map(contractors.map((c) => [c.id, c.name]));
  const villaContractorMix: Record<string, Array<{ contractor: string; count: number }>> = {};
  for (const v of probeVillas) {
    const rows = await prisma.wBSNode.groupBy({
      by: ["contractorId"],
      where: { villaId: v.id, contractorId: { not: null } },
      _count: { _all: true },
    });
    villaContractorMix[`V${v.number.toString().padStart(2, "0")}`] = rows.map((r) => ({
      contractor: contractorName.get(r.contractorId!) ?? r.contractorId!,
      count: r._count._all,
    }));
  }

  // --- 3) V06 / V07 / V08 Foundation state ---
  const foundationSection = await prisma.milestoneSection.findFirst({
    where: { projectId, name: "Foundation / Substructure" },
    select: { id: true },
  });
  const villaFoundation: Record<string, {
    colabRowsWithProgress: number;
    villaMilestoneActualStart: string | null;
    villaMilestoneActualFinish: string | null;
    starActualFinish: string | null;
  }> = {};
  if (foundationSection) {
    for (const num of [6, 7, 8]) {
      const villa = probeVillas.find((v) => v.number === num);
      if (!villa) continue;
      const [colabWithProgress, vm, star] = await Promise.all([
        prisma.colabActivity.count({
          where: { projectId, villaId: villa.id, sectionId: foundationSection.id, progressDate: { not: null, lte: cutoff } },
        }),
        prisma.villaMilestone.findFirst({
          where: { villaId: villa.id, sectionId: foundationSection.id },
          select: { actualStart: true, actualFinish: true },
        }),
        prisma.wBSNode.findFirst({
          where: { projectId, villaId: villa.id, sectionId: foundationSection.id, isSubMilestone: true },
          select: { actualFinish: true },
        }),
      ]);
      villaFoundation[`V${num.toString().padStart(2, "0")}`] = {
        colabRowsWithProgress: colabWithProgress,
        villaMilestoneActualStart: vm?.actualStart?.toISOString().slice(0, 10) ?? null,
        villaMilestoneActualFinish: vm?.actualFinish?.toISOString().slice(0, 10) ?? null,
        starActualFinish: star?.actualFinish?.toISOString().slice(0, 10) ?? null,
      };
    }
  }

  return NextResponse.json({
    date: cutoff.toISOString().slice(0, 10),
    section1: {
      totalRows,
      withProgressDate,
      plannedSum: plannedBy._sum.physicalProgress ?? 0,
      actualSum: actualBy._sum.physicalProgress ?? 0,
    },
    section2_villaContractorMix: villaContractorMix,
    section3_villaFoundation: villaFoundation,
  });
}
