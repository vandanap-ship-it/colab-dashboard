/**
 * One-off: merge the two "Elegant Construction(s)" contractor rows on
 * the Amanvana project into one canonical row.
 *
 * Background: the Oct 1 Safety Induction import auto-created
 * "Elegant Constructions" (plural, matching AV015 vendor code) because
 * the Colab CSV used "Elegant-Elegant Constructions". Siddhi already
 * had "Elegant Construction" (singular) from an earlier MSP import.
 * Two rows ended up in the picker. Site team flagged.
 *
 * Canonical: "Elegant Constructions" (plural) — matches AV015 vendor
 * code and the going-forward safety induction maker label.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_CONTRACTOR_MERGE=1 \
 *   npx tsx scripts/merge-elegant-contractors.ts
 *
 * Does one atomic transaction:
 *   1. Find both Elegant rows on Amanvana.
 *   2. Decide canonical (plural wins).
 *   3. Repoint every FK on the non-canonical row to the canonical id.
 *   4. Delete the non-canonical row.
 * Idempotent — second run is a no-op (second row already gone).
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_CONTRACTOR_MERGE !== "1") {
  console.error("Refusing to run against Neon without ALLOW_CONTRACTOR_MERGE=1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const CANONICAL_NAME = "Elegant Constructions"; // plural, matches AV015

async function main() {
  const project = await prisma.project.findFirst({ where: { name: "Amanvana" } });
  if (!project) {
    console.error("Project Amanvana not found.");
    process.exit(1);
  }

  const rows = await prisma.contractor.findMany({
    where: {
      projectId: project.id,
      name: { in: ["Elegant Construction", "Elegant Constructions"] },
    },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${rows.length} matching contractor row(s):`);
  for (const r of rows) console.log(`  ${r.name}  id=${r.id}  createdAt=${r.createdAt.toISOString()}`);

  if (rows.length === 0) {
    console.log("Nothing to merge.");
    return;
  }
  if (rows.length === 1) {
    const only = rows[0];
    if (only.name === CANONICAL_NAME) {
      console.log("Already canonical; nothing to do.");
      return;
    }
    // One row, wrong name — just rename it.
    await prisma.contractor.update({
      where: { id: only.id },
      data: { name: CANONICAL_NAME },
    });
    console.log(`Renamed sole row to "${CANONICAL_NAME}".`);
    return;
  }

  const canonical = rows.find((r) => r.name === CANONICAL_NAME) ?? rows[0];
  const dupes = rows.filter((r) => r.id !== canonical.id);
  console.log(`\nCanonical: "${canonical.name}" (${canonical.id})`);
  for (const d of dupes) console.log(`Will merge: "${d.name}" (${d.id})`);

  await prisma.$transaction(async (tx) => {
    for (const dupe of dupes) {
      // Repoint every FK that references the duplicate contractor id.
      const counts = {
        users:            await tx.user.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        progressEntries:  await tx.progressEntry.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        wbsNodes:         await tx.wBSNode.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        subContractorBill:await tx.subContractorBill.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        tradePlans:       await tx.tradePlan.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        manpowerEntries:  await tx.manpowerEntry.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        workPermits:      await tx.workPermit.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        inspections:      await tx.inspection.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
        issuesDebit:      await tx.issue.updateMany({ where: { debitToId: dupe.id }, data: { debitToId: canonical.id } }),
        hindrances:       await tx.hindrance.updateMany({ where: { responsibleContractorId: dupe.id }, data: { responsibleContractorId: canonical.id } }),
        safetyInductions: await tx.safetyInduction.updateMany({ where: { contractorId: dupe.id }, data: { contractorId: canonical.id } }),
      };
      console.log(`\nRepoint counts for "${dupe.name}" → "${canonical.name}":`);
      for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v.count}`);

      await tx.contractor.delete({ where: { id: dupe.id } });
      console.log(`Deleted "${dupe.name}" (${dupe.id})`);
    }
  });

  console.log(`\nDone. All Elegant references now point to "${canonical.name}" (${canonical.id}).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
