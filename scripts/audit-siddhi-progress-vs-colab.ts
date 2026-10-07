/**
 * Siddhi-wins audit for activity progress. READ-ONLY unless APPLY=1.
 *
 *   DATABASE_URL="postgresql://..." \
 *   PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/audit-siddhi-progress-vs-colab.ts
 *
 * Rule (Shraddha, 2026-10-07): where progress was entered in BOTH Colab
 * and Siddhi, Siddhi's wins. The in-app Colab sync (src/lib/colabSync.ts)
 * sets WBSNode.percentComplete from the Colab CSV on every matched
 * activity, so an activity the site team updated in Siddhi can end up
 * showing Colab's figure instead.
 *
 * For every activity with Siddhi-entered progress (PUBLISHED, not deleted,
 * not written by a Colab import), this compares the % Siddhi's own entries
 * imply (max cumulativeQuantity / totalQuantity) with what the activity
 * shows now, and lists every one that is lower. APPLY=1 (plus
 * ALLOW_PROGRESS_RESTORE=1 on Neon) restores Siddhi's % and re-rolls the
 * affected villa milestones.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncVillaMilestoneFromChildren } from "../src/lib/milestoneRollup";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const apply = process.env.APPLY === "1";
if (apply && /neon\.tech/i.test(url) && process.env.ALLOW_PROGRESS_RESTORE !== "1") {
  console.error("Refusing: set ALLOW_PROGRESS_RESTORE=1 to write to Neon.");
  process.exit(1);
}
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Keys written by Colab imports: "colab:" (in-app sync) and
// "colab-progress:" (the older scripts/import-colab-progress.ts).
const isColabKey = (k: string | null) => !!k && (k.startsWith("colab:") || k.startsWith("colab-progress:"));
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(apply ? "Mode: APPLY — restoring Siddhi's %" : "Mode: DRY RUN — nothing will be written (add APPLY=1 to restore)");

  const entries = await prisma.progressEntry.findMany({
    where: { projectId: project.id, deletedAt: null, status: "PUBLISHED" },
    select: { wbsNodeId: true, date: true, cumulativeQuantity: true, idempotencyKey: true, createdAt: true },
  });
  const native = entries.filter((e) => !isColabKey(e.idempotencyKey));
  console.log(`\nPublished progress entries: ${entries.length} (Colab-imported ${entries.length - native.length}, entered in Siddhi ${native.length})`);

  const byDay = new Map<string, number>();
  for (const e of native) byDay.set(day(e.date), (byDay.get(day(e.date)) ?? 0) + 1);
  console.log("Siddhi-entered progress by date:");
  for (const [d, n] of [...byDay].sort()) console.log(`  ${d}  ${n}`);

  const byNode = new Map<string, { maxCum: number; firstDate: Date; lastDate: Date }>();
  for (const e of native) {
    const s = byNode.get(e.wbsNodeId);
    if (!s) byNode.set(e.wbsNodeId, { maxCum: e.cumulativeQuantity, firstDate: e.date, lastDate: e.date });
    else {
      s.maxCum = Math.max(s.maxCum, e.cumulativeQuantity);
      if (e.date < s.firstDate) s.firstDate = e.date;
      if (e.date > s.lastDate) s.lastDate = e.date;
    }
  }
  const nodes = await prisma.wBSNode.findMany({
    where: { id: { in: [...byNode.keys()] } },
    select: {
      id: true, name: true, taskCode: true, percentComplete: true, totalQuantity: true, unit: true,
      actualStart: true, villaMilestoneId: true,
      villaMilestone: { select: { villa: { select: { number: true } }, section: { select: { name: true } } } },
    },
  });

  const regressed: Array<{ node: (typeof nodes)[number]; siddhiPct: number; firstDate: Date }> = [];
  let noQty = 0;
  for (const n of nodes) {
    const s = byNode.get(n.id)!;
    if (!n.totalQuantity || n.totalQuantity <= 0) { noQty++; continue; }
    const siddhiPct = Math.max(0, Math.min(100, (s.maxCum / n.totalQuantity) * 100));
    if (n.percentComplete + 0.01 < siddhiPct) regressed.push({ node: n, siddhiPct, firstDate: s.firstDate });
  }

  console.log(`\nActivities with Siddhi-entered progress: ${nodes.length} (${noQty} have no total quantity, so no % to compare)`);
  console.log(`Showing LESS than Siddhi's own entries imply: ${regressed.length}`);
  for (const r of regressed) {
    const where = r.node.villaMilestone
      ? `Villa ${r.node.villaMilestone.villa.number} · ${r.node.villaMilestone.section.name}`
      : "(no villa)";
    console.log(`  ${where} · ${r.node.name}  now ${r.node.percentComplete.toFixed(1)}% → Siddhi ${r.siddhiPct.toFixed(1)}%`);
  }

  if (!apply || regressed.length === 0) {
    if (!apply) console.log("\nDry run only — nothing written.");
    return;
  }

  const milestones = new Set<string>();
  await prisma.$transaction(async (tx) => {
    for (const r of regressed) {
      await tx.wBSNode.update({
        where: { id: r.node.id },
        data: {
          percentComplete: r.siddhiPct,
          progressEntered: true,
          ...(r.node.actualStart ? {} : { actualStart: r.firstDate }),
        },
      });
      if (r.node.villaMilestoneId) milestones.add(r.node.villaMilestoneId);
    }
    for (const vm of milestones) await syncVillaMilestoneFromChildren(tx, vm);
  }, { timeout: 120_000 });
  console.log(`\nRestored ${regressed.length} activit${regressed.length === 1 ? "y" : "ies"}, re-rolled ${milestones.size} villa milestone(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
