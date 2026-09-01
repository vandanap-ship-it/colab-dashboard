import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";

// Temporary diagnostic: for a given projectId + date + villa-number set,
// dump per-villa what my "planned today" query sees. Used to trace the
// Aug 26 Abraham parity gap.
//
//   GET /api/admin/debug-scorecard?projectId=...&date=2026-08-26&nums=3,4,5,6,7,8

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const dateStr = searchParams.get("date");
  const numsStr = searchParams.get("nums");
  if (!projectId || !dateStr || !numsStr) {
    return NextResponse.json({ error: "projectId, date, nums required" }, { status: 400 });
  }

  const day = new Date(dateStr + "T00:00:00Z");
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);
  const nums = numsStr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));

  const villas = await prisma.villa.findMany({
    where: { projectId, number: { in: nums } },
    select: {
      id: true, number: true, inScope: true,
      block: { select: { code: true } },
      milestones: {
        orderBy: { section: { orderIndex: "asc" } },
        select: {
          actualFinish: true,
          baselineStart: true,
          baselineFinish: true,
          section: { select: { name: true, orderIndex: true } },
          wbsNodes: {
            where: { isSubMilestone: true },
            select: { actualFinish: true },
          },
        },
      },
    },
  });

  const villaIds = villas.map((v) => v.id);

  const wbsRows = await prisma.wBSNode.findMany({
    where: { projectId, villaId: { in: villaIds } },
    select: {
      villaId: true,
      contractorId: true,
      baselineStart: true,
      baselineFinish: true,
      actualStart: true,
      actualFinish: true,
      villaMilestone: { select: { section: { select: { name: true } } } },
    },
  });

  const perVilla: Record<string, {
    number: number;
    inScope: boolean;
    block: string;
    totalWbsNodes: number;
    withContractor: number;
    withBaseline: number;
    matchesInWindow: number;
    matchesOverdueOpen: number;
    plannedToday: boolean;
    minBaselineStart: string | null;
    maxBaselineFinish: string | null;
    sampleMilestones: string[];
    milestoneChain: Array<{ s: string; idx: number; mAF: string | null; stars: Array<string | null> }>;
  }> = {};

  for (const v of villas) {
    const vRows = wbsRows.filter((r) => r.villaId === v.id);
    let inWin = 0;
    let overdueOpen = 0;
    let minBs: Date | null = null;
    let maxBf: Date | null = null;
    const ms = new Set<string>();
    for (const r of vRows) {
      if (r.baselineStart && r.baselineFinish) {
        if (r.baselineStart <= dayStart && r.baselineFinish >= dayStart) inWin++;
      }
      if (r.baselineFinish && r.baselineFinish < dayStart && r.actualFinish == null) overdueOpen++;
      if (r.baselineStart && (!minBs || r.baselineStart < minBs)) minBs = r.baselineStart;
      if (r.baselineFinish && (!maxBf || r.baselineFinish > maxBf)) maxBf = r.baselineFinish;
      if (r.villaMilestone?.section?.name) ms.add(r.villaMilestone.section.name);
    }
    perVilla[`V${v.number.toString().padStart(2, "0")}`] = {
      number: v.number,
      inScope: v.inScope,
      block: v.block?.code ?? "?",
      totalWbsNodes: vRows.length,
      withContractor: vRows.filter((r) => r.contractorId != null).length,
      withBaseline: vRows.filter((r) => r.baselineStart != null || r.baselineFinish != null).length,
      matchesInWindow: inWin,
      matchesOverdueOpen: overdueOpen,
      plannedToday: inWin > 0 || overdueOpen > 0,
      minBaselineStart: minBs?.toISOString() ?? null,
      maxBaselineFinish: maxBf?.toISOString() ?? null,
      sampleMilestones: Array.from(ms).slice(0, 5),
      // Full milestone chain — ordered by section orderIndex, actualFinish
      // per milestone plus per-★ actualFinish. Used to diagnose current-
      // stage advancement.
      milestoneChain: v.milestones.map((m) => ({
        s: m.section?.name ?? "?",
        idx: m.section?.orderIndex ?? -1,
        mAF: m.actualFinish?.toISOString().slice(0, 10) ?? null,
        stars: m.wbsNodes.map((w) => w.actualFinish?.toISOString().slice(0, 10) ?? null),
      })),
    };
  }

  return NextResponse.json({
    day: dayStart.toISOString(),
    villasFound: villas.length,
    perVilla,
  });
}
