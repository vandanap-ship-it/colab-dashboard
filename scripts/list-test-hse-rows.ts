/**
 * Dry-run inspector: lists HSE test rows that scripts/delete-test-hse-rows.ts
 * would soft-delete. No writes.
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/list-test-hse-rows.ts
 *
 * Scope (Vandana 2026-10-16):
 *   • Inspection rows with module = SAFETY (HSE Checklists)
 *   • WorkPermit rows (all types)
 *   • SafetyInduction rows
 *
 * Match rule (either signal fires):
 *   • title (or workerName for inductions) ILIKE '%test%'
 *   • raisedBy / createdBy / filledBy has role = ADMIN
 *
 * Exemptions:
 *   • Already soft-deleted rows (deletedAt IS NOT NULL)
 *   • Rows with idempotencyKey LIKE 'colab-%' — safeguard against
 *     accidentally eating anything the Colab import brought in.
 *     (The earlier wipe-test-rows.ts over-matched; this is the
 *     carve-out the memory notes.)
 *
 * Output shape: three sections (Permits, HSE Checklists, Inductions),
 * each printing id · displayId · raiser · created · title.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const COLAB_IDEMPOTENCY_PREFIX = "colab-";

function isColabImported(idempotencyKey: string | null): boolean {
  return idempotencyKey ? idempotencyKey.startsWith(COLAB_IDEMPOTENCY_PREFIX) : false;
}

function fmtDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16);
}

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
    select: {
      id: true,
      displayId: true,
      title: true,
      type: true,
      status: true,
      createdAt: true,
      idempotencyKey: true,
      requester: { select: { username: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const permitsClean = permits.filter((p) => !isColabImported(p.idempotencyKey));

  console.log("");
  console.log(`PERMITS · ${permitsClean.length} candidate(s) [${permits.length - permitsClean.length} colab-import exemptions skipped]`);
  console.log("─".repeat(100));
  for (const p of permitsClean) {
    const matched: string[] = [];
    if (/test/i.test(p.title)) matched.push("title");
    if (p.requester.role === "ADMIN") matched.push("admin");
    console.log(
      `  ${p.displayId?.padEnd(16) ?? p.id.slice(0, 10) + "...   "} ${p.type.padEnd(14)} ${p.status.padEnd(10)} ${fmtDate(p.createdAt)}  @${p.requester.username.padEnd(14)} ${p.requester.role.padEnd(14)} match=[${matched.join(",")}]  "${p.title}"`,
    );
  }

  // ── 2. HSE Checklists (Inspections with module = SAFETY) ──────────
  const inspections = await prisma.inspection.findMany({
    where: {
      deletedAt: null,
      module: "SAFETY",
      OR: [
        { title: { contains: "test", mode: "insensitive" } },
        { filledBy: { role: "ADMIN" } },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      idempotencyKey: true,
      filledBy: { select: { username: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const inspectionsClean = inspections.filter((i) => !isColabImported(i.idempotencyKey));

  console.log("");
  console.log(`HSE CHECKLISTS · ${inspectionsClean.length} candidate(s) [${inspections.length - inspectionsClean.length} colab-import exemptions skipped]`);
  console.log("─".repeat(100));
  for (const i of inspectionsClean) {
    const matched: string[] = [];
    if (/test/i.test(i.title)) matched.push("title");
    if (i.filledBy.role === "ADMIN") matched.push("admin");
    console.log(
      `  ${i.id.slice(0, 14)}  ${i.status.padEnd(10)} ${fmtDate(i.createdAt)}  @${i.filledBy.username.padEnd(14)} ${i.filledBy.role.padEnd(14)} match=[${matched.join(",")}]  "${i.title}"`,
    );
  }

  // ── 3. Safety Inductions ──────────────────────────────────────────
  const inductions = await prisma.safetyInduction.findMany({
    where: {
      deletedAt: null,
      OR: [
        { workerName: { contains: "test", mode: "insensitive" } },
        { createdBy: { role: "ADMIN" } },
      ],
    },
    select: {
      id: true,
      displayId: true,
      workerName: true,
      status: true,
      createdAt: true,
      idempotencyKey: true,
      createdBy: { select: { username: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const inductionsClean = inductions.filter((i) => !isColabImported(i.idempotencyKey));

  console.log("");
  console.log(`INDUCTIONS · ${inductionsClean.length} candidate(s) [${inductions.length - inductionsClean.length} colab-import exemptions skipped]`);
  console.log("─".repeat(100));
  for (const ind of inductionsClean) {
    const matched: string[] = [];
    if (/test/i.test(ind.workerName)) matched.push("workerName");
    if (ind.createdBy.role === "ADMIN") matched.push("admin");
    console.log(
      `  ${ind.displayId?.padEnd(16) ?? ind.id.slice(0, 10) + "...   "} ${ind.status.padEnd(10)} ${fmtDate(ind.createdAt)}  @${ind.createdBy.username.padEnd(14)} ${ind.createdBy.role.padEnd(14)} match=[${matched.join(",")}]  "${ind.workerName}"`,
    );
  }

  console.log("");
  console.log("─".repeat(100));
  console.log(`Total: ${permitsClean.length} permit(s) + ${inspectionsClean.length} HSE checklist(s) + ${inductionsClean.length} induction(s) = ${permitsClean.length + inspectionsClean.length + inductionsClean.length} row(s)`);
  console.log("");
  console.log("Nothing has been changed. Review the list above, then run");
  console.log("scripts/delete-test-hse-rows.ts with CONFIRM_DELETE=1 to soft-delete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
