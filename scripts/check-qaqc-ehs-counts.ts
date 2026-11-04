/**
 * READ-ONLY. Sanity-check the raw counts behind the QA/QC + EHS tabs so we
 * can reconcile what the dashboard shows against what the DB actually holds.
 *
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" \
 *     npx tsx --env-file=.env.local scripts/check-qaqc-ehs-counts.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName }, select: { id: true, name: true } });
  if (!project) { console.error("no project"); process.exit(1); }
  console.log(`Project: ${project.name}`);

  console.log(`\n── Inspection (any module) ──`);
  const inspByModule = await prisma.inspection.groupBy({
    by: ["module", "status"],
    where: { projectId: project.id, deletedAt: null },
    _count: { _all: true },
  });
  for (const row of inspByModule.sort((a, b) => (a.module ?? "").localeCompare(b.module ?? "") || (a.status ?? "").localeCompare(b.status ?? ""))) {
    console.log(`  ${String(row.module ?? "null").padEnd(10)}  ${String(row.status ?? "null").padEnd(12)}  ${row._count._all}`);
  }
  const inspTotal = await prisma.inspection.count({ where: { projectId: project.id, deletedAt: null } });
  console.log(`  TOTAL inspections: ${inspTotal}`);

  console.log(`\n── Issue (any module) ──`);
  const issByModule = await prisma.issue.groupBy({
    by: ["module", "status"],
    where: { projectId: project.id, deletedAt: null },
    _count: { _all: true },
  });
  for (const row of issByModule.sort((a, b) => (a.module ?? "").localeCompare(b.module ?? ""))) {
    console.log(`  ${String(row.module ?? "null").padEnd(10)}  ${String(row.status ?? "null").padEnd(12)}  ${row._count._all}`);
  }

  console.log(`\n── WorkPermit ──`);
  const permitsByStatus = await prisma.workPermit.groupBy({
    by: ["status"],
    where: { projectId: project.id, deletedAt: null },
    _count: { _all: true },
  });
  for (const row of permitsByStatus) {
    console.log(`  ${String(row.status).padEnd(14)}  ${row._count._all}`);
  }
  const permitTotal = await prisma.workPermit.count({ where: { projectId: project.id, deletedAt: null } });
  console.log(`  TOTAL permits: ${permitTotal}`);

  console.log(`\n── Observation / Induction (try both model names) ──`);
  // Try common model names; print whichever exists.
  const modelCounts = async (modelName: string): Promise<number | null> => {
    try {
      // @ts-ignore - dynamic access
      const m = (prisma as any)[modelName];
      if (!m || typeof m.count !== "function") return null;
      return await m.count({ where: { projectId: project.id, deletedAt: null } });
    } catch { return null; }
  };
  for (const name of [
    "workerInduction", "safetyInduction", "induction", "observation",
    "safetyObservation", "qaqcChecklist", "hseChecklist", "checklist", "checklistInstance",
    "concern", "hindrance",
  ]) {
    const n = await modelCounts(name);
    if (n != null) console.log(`  ${name.padEnd(25)}  ${n}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
