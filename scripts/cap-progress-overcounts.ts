/**
 * One-off cleanup: cap any PUBLISHED ProgressEntry whose cumulativeQuantity
 * sits above the activity's totalQuantity at exactly totalQuantity.
 *
 * Audit (8 Oct 2026) found 63 such entries - mostly tiny over-counts
 * from Colab imports (100.1 / 100 up to 100.9 / 100). They inflate the
 * project actual % slightly, so this cleans them before the next weekly.
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/cap-progress-overcounts.ts
 *
 * Default is DRY RUN - prints every proposed change, writes nothing.
 * To actually apply:
 *
 *   DATABASE_URL="postgresql://..." \
 *   CAP_APPLY=1 \
 *   npx tsx scripts/cap-progress-overcounts.ts
 *
 * Idempotent: a second run skips rows that already carry the auto-cap
 * marker in their notes. Updates the WBS node's percentComplete /
 * actualFinish and rolls up to VillaMilestone for every affected activity.
 */

const CAP_MARKER = "[auto-cap 2026-10-08]";

async function capProgressOvercounts() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const apply = process.env.CAP_APPLY === "1";

  const { prisma } = await import("../src/lib/prisma");
  const { syncVillaMilestoneFromChildren } = await import("../src/lib/milestoneRollup");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found");
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Mode:    ${apply ? "APPLY (writing to DB)" : "DRY RUN (no writes)"}`);
  console.log();

  // Pull every PUBLISHED progress entry with its activity's totalQuantity
  // + villa for the printable log line.
  const villas = await prisma.villa.findMany({
    where: { projectId: project.id },
    select: { id: true, number: true },
  });
  const villaById = new Map(villas.map((v) => [v.id, v]));

  const progress = await prisma.progressEntry.findMany({
    where: { projectId: project.id, status: "PUBLISHED", deletedAt: null },
    select: {
      id: true,
      displayId: true,
      date: true,
      cumulativeQuantity: true,
      achievedQuantity: true,
      notes: true,
      wbsNodeId: true,
      wbsNode: {
        select: {
          id: true,
          name: true,
          totalQuantity: true,
          villaId: true,
          villaMilestoneId: true,
          actualFinish: true,
          actualStart: true,
          percentComplete: true,
        },
      },
    },
  });

  // Over-count rule: cumulative > totalQuantity * 1.001 (same tolerance
  // the audit uses so the two reports agree).
  const overCount = progress.filter(
    (p) =>
      p.wbsNode?.totalQuantity != null &&
      p.wbsNode.totalQuantity > 0 &&
      p.cumulativeQuantity > p.wbsNode.totalQuantity * 1.001,
  );

  const alreadyCapped = overCount.filter((p) => (p.notes ?? "").includes(CAP_MARKER));
  const toCap = overCount.filter((p) => !(p.notes ?? "").includes(CAP_MARKER));

  console.log(`Found ${overCount.length} entries over 100% cumulative.`);
  console.log(`  Already capped (skipping): ${alreadyCapped.length}`);
  console.log(`  Will cap this run:         ${toCap.length}`);
  console.log();

  if (toCap.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Print the plan.
  const header = `  ${"Villa".padEnd(5)} ${"Activity".padEnd(45)} ${"Cum → Cap".padStart(16)} ${"displayId".padEnd(14)}`;
  console.log(header);
  console.log("  " + "-".repeat(header.length));
  for (const p of toCap) {
    const v = villaById.get(p.wbsNode?.villaId ?? "");
    const cap = p.wbsNode!.totalQuantity!;
    const line = `  V${String(v?.number ?? "?").padEnd(4)} ${(p.wbsNode?.name ?? "?").slice(0, 45).padEnd(45)} ${(p.cumulativeQuantity.toFixed(2) + " → " + cap.toFixed(2)).padStart(16)} ${(p.displayId ?? "").padEnd(14)}`;
    console.log(line);
  }
  console.log();

  // Which activities need their rollup recomputed afterwards.
  const affectedWbsNodeIds = Array.from(new Set(toCap.map((p) => p.wbsNodeId)));
  const affectedMilestoneIds = Array.from(
    new Set(
      toCap
        .map((p) => p.wbsNode?.villaMilestoneId)
        .filter((v): v is string => !!v),
    ),
  );

  if (!apply) {
    console.log("DRY RUN - no writes made.");
    console.log(`Re-run with CAP_APPLY=1 to apply:`);
    console.log(`  - ${toCap.length} ProgressEntry rows will be updated`);
    console.log(`  - ${affectedWbsNodeIds.length} WBSNode percentComplete / actualFinish values will be recomputed`);
    console.log(`  - ${affectedMilestoneIds.length} VillaMilestone rollups will be refreshed`);
    await prisma.$disconnect();
    return;
  }

  // Apply.
  console.log("APPLYING...");
  console.log();

  const now = new Date();
  let updatedEntries = 0;
  for (const p of toCap) {
    const cap = p.wbsNode!.totalQuantity!;
    const was = p.cumulativeQuantity;
    const note = `${CAP_MARKER} capped from ${was.toFixed(2)} to ${cap.toFixed(2)} on ${now.toISOString().slice(0, 10)} - audit cleanup`;
    const newNotes = p.notes && p.notes.trim().length > 0 ? `${p.notes.trim()}\n${note}` : note;
    await prisma.progressEntry.update({
      where: { id: p.id },
      data: { cumulativeQuantity: cap, notes: newNotes },
    });
    updatedEntries++;
  }
  console.log(`  Updated ${updatedEntries} ProgressEntry rows.`);

  // Recompute WBS percentComplete + actualFinish for each affected activity.
  // After capping, the max PUBLISHED cumulative on an activity equals its
  // totalQuantity, so pct = 100. Stamp actualFinish if not set already.
  let updatedWbs = 0;
  for (const wbsNodeId of affectedWbsNodeIds) {
    const node = await prisma.wBSNode.findUnique({
      where: { id: wbsNodeId },
      select: { totalQuantity: true, actualFinish: true, actualStart: true },
    });
    if (!node?.totalQuantity || node.totalQuantity <= 0) continue;
    const maxAgg = await prisma.progressEntry.aggregate({
      where: { wbsNodeId, status: "PUBLISHED", deletedAt: null },
      _max: { cumulativeQuantity: true, date: true },
    });
    const maxCum = maxAgg._max.cumulativeQuantity ?? 0;
    const latestDate = maxAgg._max.date ?? now;
    const pct = Math.max(0, Math.min(100, (maxCum / node.totalQuantity) * 100));
    const data: {
      percentComplete: number;
      actualFinish?: Date;
      actualStart?: Date;
    } = { percentComplete: pct };
    if (pct >= 100 && !node.actualFinish) data.actualFinish = latestDate;
    if (!node.actualStart) data.actualStart = latestDate;
    await prisma.wBSNode.update({ where: { id: wbsNodeId }, data });
    updatedWbs++;
  }
  console.log(`  Recomputed ${updatedWbs} WBSNode rollups.`);

  // Roll up to VillaMilestone.
  let updatedMilestones = 0;
  for (const milestoneId of affectedMilestoneIds) {
    try {
      await syncVillaMilestoneFromChildren(prisma, milestoneId);
      updatedMilestones++;
    } catch (e) {
      console.warn(`  WARN: milestone ${milestoneId} rollup failed:`, (e as Error).message);
    }
  }
  console.log(`  Refreshed ${updatedMilestones} VillaMilestone rollups.`);

  console.log();
  console.log(`Done. Re-run the audit to confirm the over-count finding is now 0.`);

  await prisma.$disconnect();
}

capProgressOvercounts().catch((e) => {
  console.error(e);
  process.exit(1);
});
