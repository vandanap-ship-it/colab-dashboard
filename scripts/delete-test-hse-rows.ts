/**
 * Soft-delete HSE test rows that list-test-hse-rows.ts flagged.
 *
 *   DATABASE_URL="postgresql://..." \
 *   CONFIRM_DELETE=1 \
 *   npx tsx scripts/delete-test-hse-rows.ts
 *
 * Without CONFIRM_DELETE=1 the script runs the same query but ONLY
 * prints a summary — functionally the same as the lister. Pass
 * CONFIRM_DELETE=1 to actually set deletedAt on each matching row.
 *
 * Scope + match rule + exemptions mirror list-test-hse-rows.ts
 * exactly (see that file for the rationale).
 *
 * Soft-delete via `deletedAt = now()` on all three models (every
 * model has the column, every list / count / detail / cron query
 * filters `deletedAt IS NULL`). To restore a single row: the error
 * output of the earlier delete-test-permit.ts shows the exact SQL —
 *   UPDATE "WorkPermit" SET "deletedAt" = NULL WHERE id = '...';
 * same pattern works for Inspection and SafetyInduction.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const confirmed = process.env.CONFIRM_DELETE === "1";
if (/neon\.tech/i.test(url) && !confirmed) {
  console.log("DRY RUN. Set CONFIRM_DELETE=1 to actually soft-delete.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const COLAB_IDEMPOTENCY_PREFIX = "colab-";
const now = new Date();

async function main() {
  // ── 1. Work Permits ────────────────────────────────────────────────
  const permits = await prisma.workPermit.findMany({
    where: {
      deletedAt: null,
      OR: [
        { title: { contains: "test", mode: "insensitive" } },
        { requester: { role: "ADMIN" } },
      ],
    },
    select: { id: true, displayId: true, title: true, idempotencyKey: true },
  });
  const permitIds = permits
    .filter((p) => !p.idempotencyKey?.startsWith(COLAB_IDEMPOTENCY_PREFIX))
    .map((p) => p.id);

  // ── 2. HSE Checklists ──────────────────────────────────────────────
  const inspections = await prisma.inspection.findMany({
    where: {
      deletedAt: null,
      module: "SAFETY",
      OR: [
        { title: { contains: "test", mode: "insensitive" } },
        { filledBy: { role: "ADMIN" } },
      ],
    },
    select: { id: true, title: true, idempotencyKey: true },
  });
  const inspectionIds = inspections
    .filter((i) => !i.idempotencyKey?.startsWith(COLAB_IDEMPOTENCY_PREFIX))
    .map((i) => i.id);

  // ── 3. Safety Inductions ───────────────────────────────────────────
  const inductions = await prisma.safetyInduction.findMany({
    where: {
      deletedAt: null,
      OR: [
        { workerName: { contains: "test", mode: "insensitive" } },
        { createdBy: { role: "ADMIN" } },
      ],
    },
    select: { id: true, displayId: true, workerName: true, idempotencyKey: true },
  });
  const inductionIds = inductions
    .filter((i) => !i.idempotencyKey?.startsWith(COLAB_IDEMPOTENCY_PREFIX))
    .map((i) => i.id);

  console.log("");
  console.log(`Matched: ${permitIds.length} permit(s) · ${inspectionIds.length} HSE checklist(s) · ${inductionIds.length} induction(s)`);

  if (!confirmed) {
    console.log("");
    console.log("Dry run. Re-run with CONFIRM_DELETE=1 to actually soft-delete these rows.");
    return;
  }

  // ── Soft-delete, in a single transaction per model (any failure
  //    rolls back only that model's updates; the earlier ones stay). ──
  const permitRes = await prisma.workPermit.updateMany({
    where: { id: { in: permitIds } },
    data: { deletedAt: now },
  });
  console.log(`  → Permits:        ${permitRes.count} soft-deleted`);

  const inspectionRes = await prisma.inspection.updateMany({
    where: { id: { in: inspectionIds } },
    data: { deletedAt: now },
  });
  console.log(`  → HSE Checklists: ${inspectionRes.count} soft-deleted`);

  const inductionRes = await prisma.safetyInduction.updateMany({
    where: { id: { in: inductionIds } },
    data: { deletedAt: now },
  });
  console.log(`  → Inductions:     ${inductionRes.count} soft-deleted`);

  console.log("");
  console.log("Done. Rows are hidden from every list / count / cron. To restore one:");
  console.log('  UPDATE "WorkPermit"      SET "deletedAt" = NULL WHERE id = \'<id>\';');
  console.log('  UPDATE "Inspection"      SET "deletedAt" = NULL WHERE id = \'<id>\';');
  console.log('  UPDATE "SafetyInduction" SET "deletedAt" = NULL WHERE id = \'<id>\';');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
