/**
 * Read-only probe: find every PUBLISHED ProgressEntry whose
 * achievedQuantity OR cumulativeQuantity is negative, and print full
 * context so Vandana can decide what to do (void, correct, or leave).
 *
 * Audit (8 Oct 2026) found 1 such row. Prints it in full.
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/find-negative-progress.ts
 *
 * No writes. Safe against prod.
 */

async function findNegativeProgress() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const { prisma } = await import("../src/lib/prisma");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found");

  const villas = await prisma.villa.findMany({
    where: { projectId: project.id },
    select: { id: true, number: true, label: true },
  });
  const villaById = new Map(villas.map((v) => [v.id, v]));

  const rows = await prisma.progressEntry.findMany({
    where: {
      projectId: project.id,
      status: "PUBLISHED",
      deletedAt: null,
      OR: [
        { achievedQuantity: { lt: 0 } },
        { cumulativeQuantity: { lt: 0 } },
      ],
    },
    include: {
      wbsNode: {
        select: {
          name: true,
          villaId: true,
          totalQuantity: true,
          unit: true,
        },
      },
      contractor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      labour: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Found ${rows.length} PUBLISHED row(s) with negative achieved or cumulative.`);
  console.log();

  if (rows.length === 0) {
    console.log("Nothing to show.");
    await prisma.$disconnect();
    return;
  }

  for (const r of rows) {
    const v = villaById.get(r.wbsNode?.villaId ?? "");
    const sourceColab = r.idempotencyKey?.startsWith("colab-") ? "Colab import" : "Siddhi entry";
    console.log(`----------------------------------------------------------------`);
    console.log(`  Progress ID (display) : ${r.displayId ?? "-"}`);
    console.log(`  Progress ID (db)      : ${r.id}`);
    console.log(`  Entered on            : ${r.date.toISOString().slice(0, 10)}  (created ${r.createdAt.toISOString()})`);
    console.log(`  Villa                 : V${v?.number ?? "?"}${v?.label ? "  (" + v.label + ")" : ""}`);
    console.log(`  Activity              : ${r.wbsNode?.name ?? "-"}`);
    console.log(`  Total quantity        : ${r.wbsNode?.totalQuantity ?? "-"} ${r.wbsNode?.unit ?? ""}`);
    console.log(`  Achieved quantity     : ${r.achievedQuantity}`);
    console.log(`  Cumulative quantity   : ${r.cumulativeQuantity}`);
    console.log(`  Contractor            : ${r.contractor?.name ?? "-"}`);
    console.log(`  Type                  : ${r.type}`);
    console.log(`  Reason code / note    : ${r.reasonCode ?? "-"} / ${r.reasonNote ?? "-"}`);
    console.log(`  Notes                 : ${r.notes ?? "-"}`);
    console.log(`  Labour attached       : ${r.labour.length > 0 ? r.labour.map((l) => `${l.category}:${l.count}`).join(", ") : "none"}`);
    console.log(`  Entered by            : ${r.createdBy?.name ?? r.createdBy?.email ?? "-"}`);
    console.log(`  Source                : ${sourceColab}`);
    console.log(`  Idempotency key       : ${r.idempotencyKey ?? "-"}`);
    console.log();
  }

  console.log(`Decide per row:`);
  console.log(`  - VOID    : soft-delete via admin / Siddhi UI (sets deletedAt). The row disappears from reports.`);
  console.log(`  - CORRECT : edit the row in Siddhi; set achieved/cumulative to the right non-negative value.`);
  console.log(`  - LEAVE   : if intentional (e.g. a planned reversal), add a note so future audits know.`);
  console.log();
  console.log(`If you want a cap-at-zero script to force-fix these, say the word.`);

  await prisma.$disconnect();
}

findNegativeProgress().catch((e) => {
  console.error(e);
  process.exit(1);
});
