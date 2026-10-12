/**
 * One-off backfill: set Contractor.showInPickers=false for the three
 * labour-supply vendors the Oct 1 Colab safety-induction import
 * auto-created. These contractors should not appear in the mobile
 * pickers (New Progress / Inspection / Permit contractor dropdowns)
 * because the site team only ever picks Abraham Thomas or Elegant
 * Constructions as the executing contractor.
 *
 * Their existing safety-induction rows + any other back-references
 * stay intact — this flag only hides the row from pickers, it does
 * not soft-delete.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_CONTRACTOR_HIDE=1 \
 *   npx tsx scripts/hide-labour-supply-contractors.ts
 *
 * Idempotent: a second run is a no-op.
 */

const TARGET_NAMES = ["Achyutananda Naik", "Nilakar", "Sanjay Das"];

async function hideLabourSupplyContractors() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (/neon\.tech/i.test(url) && process.env.ALLOW_CONTRACTOR_HIDE !== "1") {
    console.error("Refusing to run against Neon without ALLOW_CONTRACTOR_HIDE=1.");
    process.exit(1);
  }

  const { prisma } = await import("../src/lib/prisma");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found");

  const rows = await prisma.contractor.findMany({
    where: { projectId: project.id, name: { in: TARGET_NAMES } },
    select: { id: true, name: true, showInPickers: true },
    orderBy: { name: "asc" },
  });

  console.log(`Project: ${project.name}`);
  console.log(`Target names: ${TARGET_NAMES.join(", ")}`);
  console.log(`Found: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(24)} id=${r.id}  showInPickers=${r.showInPickers}`);
  }

  const toHide = rows.filter((r) => r.showInPickers);
  if (toHide.length === 0) {
    console.log(`\nAll targets are already hidden. Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.contractor.updateMany({
    where: { id: { in: toHide.map((r) => r.id) } },
    data: { showInPickers: false },
  });
  console.log(`\nHidden ${result.count} contractor(s). They will no longer appear in the mobile pickers.`);
  console.log(`Toggle back on at /projects/${project.id}/admin/contractors if ever needed.`);

  await prisma.$disconnect();
}

hideLabourSupplyContractors().catch((e) => {
  console.error(e);
  process.exit(1);
});
