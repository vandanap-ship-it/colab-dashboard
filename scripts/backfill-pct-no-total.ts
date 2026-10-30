/**
 * Backfill WBSNode.percentComplete + actualStart/Finish + progressEntered
 * for activities with no scheduled totalQuantity.
 *
 * Why this exists: the mobile Save-progress form has always sent its 0-100
 * slider value as `cumulativeQuantity` when the WBSNode's totalQuantity is
 * null/0 (the client's own comment at NewProgressForm.tsx says so). But
 * the server-side rollup in POST/PATCH/publish gated the WBSNode update
 * on `totalQuantity > 0 ONLY`, so for every un-quantified activity the
 * ProgressEntry row was saved but the picker's "% complete" badge never
 * moved. Harish's team (Progress) reported it on 2026-10-30 for Block-14
 * Villa 49: entries saved, picker still shows 0% not started. Same bug
 * affects the villa-milestone rollup since that reads from WBSNode.
 *
 * This script walks every WBSNode in the project where:
 *   - totalQuantity is NULL or 0
 *   - there is at least one PUBLISHED, non-deleted ProgressEntry
 * and derives:
 *   - percentComplete  = clamp(0, 100, LATEST published entry's cumulativeQuantity)
 *   - progressEntered  = true
 *   - actualStart      = EARLIEST published entry's date (only if currently null)
 *   - actualFinish     = LATEST published entry's date (only if pct ≥ 100 and not already set)
 * Matches what the fixed POST handler would have done had the bug not existed.
 *
 * After all nodes are updated, every touched villaMilestoneId is re-rolled
 * via syncVillaMilestoneFromChildren so the Milestone Progress table, Block-
 * wise Progress and the mobile Pick-a-milestone screen all catch up.
 *
 * NO EMAILS are sent — retroactive milestone-completion emails weeks after
 * the fact would just confuse the site team.
 *
 * Default is DRY RUN (no writes). Pass COMMIT=1 to actually apply.
 *
 *   # Preview:
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" \
 *     npx tsx --env-file=.env.local scripts/backfill-pct-no-total.ts
 *
 *   # Apply:
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" COMMIT=1 \
 *     npx tsx --env-file=.env.local scripts/backfill-pct-no-total.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncVillaMilestoneFromChildren } from "../src/lib/milestoneRollup";
import { pctFromCumulative } from "../src/lib/progress";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const COMMIT = process.env.COMMIT === "1";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

type NodeRow = {
  id: string;
  taskCode: string;
  name: string;
  totalQuantity: number | null;
  percentComplete: number | null;
  progressEntered: boolean;
  actualStart: Date | null;
  actualFinish: Date | null;
  villaMilestoneId: string | null;
  villaMilestone: {
    villa: { number: number; label: string | null; block: { code: string } } | null;
    section: { name: string } | null;
  } | null;
};

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }

  console.log(`\nProject: ${project.name}`);
  console.log(`Mode:    ${COMMIT ? "COMMIT (writes will be applied)" : "DRY RUN (no writes)"}\n`);

  // 1. Find candidate nodes: no totalQuantity + at least one PUBLISHED entry.
  //    Pulls the full node row because we also need its current state to
  //    decide whether an update is actually needed (avoid audit-noise rewrites).
  const nodes = (await prisma.wBSNode.findMany({
    where: {
      projectId: project.id,
      OR: [{ totalQuantity: null }, { totalQuantity: 0 }],
      progressEntries: {
        some: { status: "PUBLISHED", deletedAt: null },
      },
    },
    select: {
      id: true,
      taskCode: true,
      name: true,
      totalQuantity: true,
      percentComplete: true,
      progressEntered: true,
      actualStart: true,
      actualFinish: true,
      villaMilestoneId: true,
      villaMilestone: {
        select: {
          villa: {
            select: { number: true, label: true, block: { select: { code: true } } },
          },
          section: { select: { name: true } },
        },
      },
    },
  })) as NodeRow[];

  console.log(`Candidate activities (no totalQuantity, has >= 1 published entry): ${nodes.length}`);

  let changed = 0;
  let unchanged = 0;
  const touchedMilestoneIds = new Set<string>();

  for (const node of nodes) {
    // Latest + earliest published entries for this node, in one query.
    const entries = await prisma.progressEntry.findMany({
      where: { wbsNodeId: node.id, status: "PUBLISHED", deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { date: true, createdAt: true, cumulativeQuantity: true },
    });
    if (entries.length === 0) continue; // defensive — the `some` filter above should have excluded these

    const latest = entries[entries.length - 1];
    const earliest = entries[0];
    const derivedPct = pctFromCumulative(latest.cumulativeQuantity, node.totalQuantity);
    const currentPct = Math.round((node.percentComplete ?? 0) * 100) / 100;
    const nextPct = Math.round(derivedPct * 100) / 100;

    const nextActualStart = node.actualStart ?? earliest.date;
    const nextActualFinish =
      derivedPct >= 100 ? node.actualFinish ?? latest.date : node.actualFinish;

    const needs =
      currentPct !== nextPct ||
      !node.progressEntered ||
      node.actualStart?.getTime() !== nextActualStart.getTime() ||
      (node.actualFinish?.getTime() ?? null) !== (nextActualFinish?.getTime() ?? null);

    const locLabel = node.villaMilestone?.villa
      ? `${node.villaMilestone.villa.block.code}/${node.villaMilestone.villa.label ?? `V${node.villaMilestone.villa.number}`}/${node.villaMilestone.section?.name ?? "—"}`
      : "(unlinked)";

    if (!needs) {
      unchanged++;
      continue;
    }

    changed++;
    console.log(
      `  ${node.taskCode.padEnd(14)} ${locLabel.padEnd(28)} ` +
        `pct ${currentPct}→${nextPct}  entries ${entries.length}  ` +
        `start ${node.actualStart ? "kept" : "set"}  ` +
        `finish ${nextActualFinish ? (node.actualFinish ? "kept" : "set") : "—"}`,
    );

    if (COMMIT) {
      await prisma.wBSNode.update({
        where: { id: node.id },
        data: {
          percentComplete: nextPct,
          progressEntered: true,
          actualStart: nextActualStart,
          actualFinish: nextActualFinish,
        },
      });
      if (node.villaMilestoneId) touchedMilestoneIds.add(node.villaMilestoneId);
    } else if (node.villaMilestoneId) {
      // Record the roll-up targets even in dry-run so the preview is honest
      // about which milestones would re-sync.
      touchedMilestoneIds.add(node.villaMilestoneId);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  ${nodes.length} candidate nodes scanned`);
  console.log(`  ${changed} would update ${COMMIT ? "(applied)" : "(dry run)"}`);
  console.log(`  ${unchanged} already correct`);
  console.log(`  ${touchedMilestoneIds.size} villa milestones to re-roll ${COMMIT ? "(will run)" : "(dry run)"}`);

  if (COMMIT && touchedMilestoneIds.size > 0) {
    console.log(`\nRe-rolling ${touchedMilestoneIds.size} villa milestones...`);
    let i = 0;
    for (const vmId of touchedMilestoneIds) {
      await syncVillaMilestoneFromChildren(prisma, vmId);
      i++;
      if (i % 25 === 0) console.log(`  ...${i}/${touchedMilestoneIds.size}`);
    }
    console.log(`  done.`);
  }

  console.log(`\n${COMMIT ? "Backfill complete." : "Dry run complete. Re-run with COMMIT=1 to apply."}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
