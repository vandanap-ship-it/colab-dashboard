/**
 * READ-ONLY. Pulls the ground-truth numbers the dashboard should be showing
 * so we can reconcile the Overview + Progress tabs before the Nov-5 review.
 *
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" \
 *     npx tsx --env-file=.env.local scripts/verify-dashboard-data.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: {
      id: true, name: true,
      startDate: true, endDate: true,
      projectedEndDate: true, reraEndDate: true,
    },
  });
  if (!project) { console.error(`no project ${projectName}`); process.exit(1); }
  console.log("Project:", project);

  const [rowCount, sumUnits] = await Promise.all([
    prisma.villa.count({ where: { projectId: project.id, inScope: true } }),
    prisma.villa.aggregate({
      where: { projectId: project.id, inScope: true },
      _sum: { unitCount: true },
    }),
  ]);
  console.log(`\nVilla.inScope rows = ${rowCount}   sum(unitCount) = ${sumUnits._sum.unitCount ?? 0}`);

  const contractors = await prisma.contractor.findMany({
    where: { projectId: project.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, showInPickers: true },
  });
  console.log(`\nContractors (${contractors.length}):`);
  for (const c of contractors) {
    console.log(`  ${c.showInPickers ? "visible" : "hidden "}  ${c.name}  (${c.id.slice(0, 8)}...)`);
  }

  const w = await prisma.villaMilestone.aggregate({
    where: { villa: { projectId: project.id, inScope: true } },
    _min: { baselineStart: true, projectedFinish: true },
    _max: { baselineFinish: true, projectedFinish: true },
  });
  console.log(
    `\nBaseline window: ${iso(w._min.baselineStart)} → ${iso(w._max.baselineFinish)}  ·  ` +
    `latest projected finish ${iso(w._max.projectedFinish)}`,
  );

  const openH = await prisma.hindrance.count({ where: { projectId: project.id, status: "OPEN" } });
  const totalH = await prisma.hindrance.count({ where: { projectId: project.id } });
  console.log(`\nHindrances:  OPEN ${openH}  ·  TOTAL ${totalH}`);

  const pgroups = await prisma.progressEntry.groupBy({
    by: ["reasonCode"],
    where: { projectId: project.id, deletedAt: null, reasonCode: { not: null } },
    _count: { _all: true },
  });
  console.log(`\nProgressEntry delay-reason totals (all time):`);
  for (const g of pgroups.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${String(g._count._all).padStart(5)}  ${g.reasonCode}`);
  }

  // The same totals grouped by contractor
  const perContractor = await prisma.progressEntry.groupBy({
    by: ["contractorId", "reasonCode"],
    where: { projectId: project.id, deletedAt: null, reasonCode: { not: null } },
    _count: { _all: true },
  });
  const byC = new Map<string, Map<string, number>>();
  for (const row of perContractor) {
    const key = row.contractorId ?? "__none__";
    const m = byC.get(key) ?? new Map();
    m.set(row.reasonCode ?? "UNSPECIFIED", (m.get(row.reasonCode ?? "UNSPECIFIED") ?? 0) + row._count._all);
    byC.set(key, m);
  }
  const names = new Map(contractors.map((c) => [c.id, c.name]));
  console.log(`\nDelay reasons grouped by contractor:`);
  for (const [cid, reasons] of byC) {
    const name = cid === "__none__" ? "(no contractor)" : names.get(cid) ?? cid;
    const total = [...reasons.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${name}  (total ${total})`);
    for (const [code, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)}  ${code}`);
    }
  }

  const now = new Date();
  const [plannedPast, actualPast] = await Promise.all([
    prisma.villaMilestone.count({
      where: { villa: { projectId: project.id, inScope: true }, baselineFinish: { lte: now } },
    }),
    prisma.villaMilestone.count({
      where: { villa: { projectId: project.id, inScope: true }, baselineFinish: { lte: now }, actualFinish: { not: null } },
    }),
  ]);
  console.log(`\nMilestones baseline-due by today: ${plannedPast}  ·  closed: ${actualPast}  ·  gap: ${plannedPast - actualPast}`);

  // Section-level planned vs actual (same math the Progress tab uses)
  const sections = await prisma.milestoneSection.findMany({
    where: { projectId: project.id },
    orderBy: { orderIndex: "asc" },
    select: { id: true, code: true, name: true },
  });
  console.log(`\nSection progress today:`);
  for (const s of sections) {
    const [total, planned, actual] = await Promise.all([
      prisma.villaMilestone.count({ where: { sectionId: s.id, villa: { inScope: true } } }),
      prisma.villaMilestone.count({ where: { sectionId: s.id, villa: { inScope: true }, baselineFinish: { lte: now } } }),
      prisma.villaMilestone.count({ where: { sectionId: s.id, villa: { inScope: true }, baselineFinish: { lte: now }, actualFinish: { not: null } } }),
    ]);
    if (total === 0) continue;
    const plannedPct = (planned / total) * 100;
    const actualPct = (actual / total) * 100;
    const variance = actualPct - plannedPct;
    console.log(
      `  [${s.code}] ${s.name.padEnd(35)}  ` +
      `planned ${plannedPct.toFixed(1).padStart(5)}%  ` +
      `actual ${actualPct.toFixed(1).padStart(5)}%  ` +
      `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`,
    );
  }

  // Blocks: one row per block with the rollup server's current numbers
  const blocks = await prisma.block.findMany({
    where: { projectId: project.id },
    orderBy: { orderIndex: "asc" },
    select: { id: true, code: true, orderIndex: true, _count: { select: { villas: true } } },
  });
  console.log(`\nBlocks (${blocks.length}):`);
  for (const b of blocks) {
    console.log(`  [${b.orderIndex}] ${b.code.padEnd(6)}  ${b._count.villas} villas`);
  }

  // Today manpower snapshot
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [plansToday, mpToday] = await Promise.all([
    prisma.tradePlan.count({
      where: { projectId: project.id, deletedAt: null, startDate: { lte: dayStart }, OR: [{ endDate: null }, { endDate: { gt: dayStart } }] },
    }),
    prisma.manpowerEntry.aggregate({
      where: { projectId: project.id, entryDate: dayStart, deletedAt: null },
      _sum: { actualCount: true },
    }),
  ]);
  console.log(`\nToday manpower: tradePlan count=${plansToday}  ·  actual headcount=${mpToday._sum.actualCount ?? 0}`);

  await prisma.$disconnect();
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

main().catch((e) => { console.error(e); process.exit(1); });
