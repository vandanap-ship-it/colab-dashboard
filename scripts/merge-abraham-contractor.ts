/**
 * One-off merge for the duplicate "Abraham Thomas" contractor in Amanvana.
 *
 * Colab's data ended up with two Contractor rows for what should be one
 * legal entity — "Abraham Thomas" and "Abraham Thomas (A&T)". Both carry
 * activity via WBS assignments, progress entries, permits, etc. This
 * script:
 *
 *   1. Picks the canonical row (plain "Abraham Thomas" — matches the
 *      41-villa contract number).
 *   2. Dry-runs: counts every FK on the duplicate and prints them.
 *   3. Repoints all FKs to the canonical row.
 *   4. Deletes the duplicate.
 *
 * The separate 90 → 93 villa-scope reconciliation lives in
 * scripts/reconcile-amanvana-villa-scope.ts — that's a Villa (row-level)
 * flip, not a Project (field-level) tweak, because plot count is derived
 * from Villa.inScope rows.
 *
 * Usage:
 *
 *   DATABASE_URL="postgresql://..." \
 *   MERGE_CONFIRM=yes \
 *   npx tsx scripts/merge-abraham-contractor.ts
 *
 * Without MERGE_CONFIRM=yes it's dry-run — prints what it would do but
 * writes nothing. Safe to re-run; a second live run is a no-op once the
 * duplicate is gone.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CANONICAL_NAME_SUBSTR = "abraham thomas"; // lowercase for match
const DUPLICATE_NAME_SUBSTR = "a&t"; // duplicate uniquely contains "(A&T)"
const PROJECT_NAME_SUBSTR = "amanvana"; // scope search to Amanvana

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required. Copy it from your Neon dashboard and re-run:\n");
  console.error("  DATABASE_URL='postgresql://...' MERGE_CONFIRM=yes npx tsx scripts/merge-abraham-contractor.ts\n");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const live = process.env.MERGE_CONFIRM === "yes";
  console.log(`\n=== Merge Abraham Thomas duplicate ===`);
  console.log(`Mode: ${live ? "LIVE (will write)" : "DRY RUN (read only)"}\n`);

  // 1. Find the Amanvana project.
  const project = await prisma.project.findFirst({
    where: { name: { contains: PROJECT_NAME_SUBSTR, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!project) {
    throw new Error(`No project matching "${PROJECT_NAME_SUBSTR}" — aborting.`);
  }
  const [villaCount, inScopeCount] = await Promise.all([
    prisma.villa.count({ where: { projectId: project.id } }),
    prisma.villa.count({ where: { projectId: project.id, inScope: true } }),
  ]);
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`  Villa rows: ${villaCount}  in-scope: ${inScopeCount}\n`);

  // 2. Load all contractors for the project so we can eyeball what's there.
  const allContractors = await prisma.contractor.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Contractors on the project:`);
  for (const c of allContractors) {
    console.log(`  ${c.id}  ${c.active ? "active" : "inactive"}  ${c.name}  (created ${c.createdAt.toISOString().slice(0, 10)})`);
  }
  console.log();

  // 3. Identify canonical + duplicate.
  //
  // Whichever row has MORE FKs pointing at it wins — that's the real historical
  // row with all the data. Then we rename the winner to the clean canonical
  // label ("Abraham Thomas") and drop the loser. This handles both cases:
  //   - The plain "Abraham Thomas" is the original and "(A&T)" is stale
  //     (delete A&T, canonical name already correct — no rename needed).
  //   - The "(A&T)" row is the original and plain "Abraham Thomas" is a
  //     fresh empty duplicate the importer created (rename A&T → plain,
  //     delete the fresh row).
  const abrahams = allContractors.filter((c) =>
    c.name.toLowerCase().includes(CANONICAL_NAME_SUBSTR),
  );
  if (abrahams.length < 2) {
    console.log(`Only ${abrahams.length} Abraham row(s) found — nothing to merge. Exiting.`);
    return;
  }
  const CLEAN_NAME = "Abraham Thomas"; // final label after merge
  // Score each candidate by total FK count so we keep the row carrying data.
  async function scoreFks(cId: string): Promise<number> {
    const [a, b, c, d, e, f] = await Promise.all([
      prisma.wBSNode.count({ where: { contractorId: cId } }),
      prisma.progressEntry.count({ where: { contractorId: cId } }),
      prisma.workPermit.count({ where: { contractorId: cId } }),
      prisma.subContractorBill.count({ where: { contractorId: cId } }),
      prisma.tradePlan.count({ where: { contractorId: cId } }),
      prisma.manpowerEntry.count({ where: { contractorId: cId } }),
    ]);
    return a + b + c + d + e + f;
  }
  const scored = await Promise.all(
    abrahams.map(async (c) => ({ ...c, fkTotal: await scoreFks(c.id) })),
  );
  scored.sort((a, b) => b.fkTotal - a.fkTotal); // highest first
  const canonical = scored[0];
  const duplicate = scored[1];
  console.log(`Candidate scores:`);
  for (const s of scored) console.log(`  ${s.fkTotal.toString().padStart(6)} FKs  ${s.id}  "${s.name}"`);
  console.log();
  console.log(`CANONICAL: ${canonical.id}  "${canonical.name}"  (${canonical.fkTotal} FKs)`);
  console.log(`DUPLICATE: ${duplicate.id}  "${duplicate.name}"  (${duplicate.fkTotal} FKs)`);
  if (canonical.name !== CLEAN_NAME) {
    console.log(`Rename planned: "${canonical.name}" → "${CLEAN_NAME}"`);
  }
  console.log();
  // Reference `DUPLICATE_NAME_SUBSTR` so tsc doesn't warn about an unused const.
  void DUPLICATE_NAME_SUBSTR;

  // 4. Count FKs on the duplicate. Prisma has six models with contractorId:
  //    WBSNode, ProgressEntry, WorkPermit, SubContractorBill, TradePlan,
  //    ManpowerEntry. Also handle Contractor's own `parentId` self-ref if
  //    the duplicate is a parent of anything (unlikely but safe).
  const [wbsCount, peCount, wpCount, sbCount, tpCount, meCount] = await Promise.all([
    prisma.wBSNode.count({ where: { contractorId: duplicate.id } }),
    prisma.progressEntry.count({ where: { contractorId: duplicate.id } }),
    prisma.workPermit.count({ where: { contractorId: duplicate.id } }),
    prisma.subContractorBill.count({ where: { contractorId: duplicate.id } }),
    prisma.tradePlan.count({ where: { contractorId: duplicate.id } }),
    prisma.manpowerEntry.count({ where: { contractorId: duplicate.id } }),
  ]);
  console.log(`FKs to repoint on the duplicate:`);
  console.log(`  WBSNode:           ${wbsCount}`);
  console.log(`  ProgressEntry:     ${peCount}`);
  console.log(`  WorkPermit:        ${wpCount}`);
  console.log(`  SubContractorBill: ${sbCount}`);
  console.log(`  TradePlan:         ${tpCount}`);
  console.log(`  ManpowerEntry:     ${meCount}`);
  const totalFks = wbsCount + peCount + wpCount + sbCount + tpCount + meCount;
  console.log(`  Total:             ${totalFks}\n`);

  if (!live) {
    console.log(`(dry run — re-run with MERGE_CONFIRM=yes to apply the merge)\n`);
    return;
  }

  // 5. Compute ManpowerEntry collisions OUTSIDE the transaction — the
  //    unique (projectId, contractorId, trade, entryDate) constraint means
  //    if both contractors logged the same trade on the same day, the
  //    repoint would collide. Build a key-set of what canonical already has,
  //    then figure out which of duplicate's rows would collide.
  const canonicalMeRows = await prisma.manpowerEntry.findMany({
    where: { contractorId: canonical.id },
    select: { projectId: true, trade: true, entryDate: true },
  });
  const canonicalMeKeys = new Set(
    canonicalMeRows.map((r) => `${r.projectId}|${r.trade}|${r.entryDate.toISOString()}`),
  );
  const dupMeRows = await prisma.manpowerEntry.findMany({
    where: { contractorId: duplicate.id },
    select: { id: true, projectId: true, trade: true, entryDate: true },
  });
  const meIdsToDrop = dupMeRows
    .filter((r) => canonicalMeKeys.has(`${r.projectId}|${r.trade}|${r.entryDate.toISOString()}`))
    .map((r) => r.id);
  console.log(`  ManpowerEntry collisions to drop before repoint: ${meIdsToDrop.length}`);

  // Now apply the merge in one transaction. 90-second timeout leaves plenty
  // of headroom over the ~3300 FK updates that follow.
  await prisma.$transaction(async (tx) => {
    if (meIdsToDrop.length > 0) {
      const del = await tx.manpowerEntry.deleteMany({ where: { id: { in: meIdsToDrop } } });
      console.log(`  ManpowerEntry: dropped ${del.count} colliding rows`);
    }

    // Repoint all six tables.
    const upd = await Promise.all([
      tx.wBSNode.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
      tx.progressEntry.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
      tx.workPermit.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
      tx.subContractorBill.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
      tx.tradePlan.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
      tx.manpowerEntry.updateMany({ where: { contractorId: duplicate.id }, data: { contractorId: canonical.id } }),
    ]);
    console.log(
      `  Repointed: WBS ${upd[0].count} · Progress ${upd[1].count} · Permit ${upd[2].count} · Bill ${upd[3].count} · TradePlan ${upd[4].count} · Manpower ${upd[5].count}`,
    );

    // Delete the duplicate contractor row.
    await tx.contractor.delete({ where: { id: duplicate.id } });
    console.log(`  Deleted duplicate contractor row ${duplicate.id}`);

    // Rename the canonical row to the clean label so the final data reads
    // just "Abraham Thomas" — no "(A&T)" suffix.
    if (canonical.name !== CLEAN_NAME) {
      await tx.contractor.update({
        where: { id: canonical.id },
        data: { name: CLEAN_NAME },
      });
      console.log(`  Renamed canonical: "${canonical.name}" → "${CLEAN_NAME}"`);
    }
  }, {
    maxWait: 10_000,
    timeout: 120_000, // Prisma's default is 5s — way too short for ~3300 FK writes.
  });

  console.log(`\n✓ Merge complete. Re-run with MERGE_CONFIRM=yes to verify (should be a no-op).\n`);
}

main()
  .catch((err) => {
    console.error("Merge failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
