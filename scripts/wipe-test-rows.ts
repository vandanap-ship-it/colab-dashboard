/**
 * One-off: hard-delete test-mode rows left behind from E2E runs across
 * Siddhi before the site team logs in. Matches rows whose title /
 * description / submitRemark / reviewerNote contain any of E2E, TEST,
 * or "testing" (case-insensitive).
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_TEST_WIPE=1 \
 *   PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/wipe-test-rows.ts
 *
 * Scope:
 *   - Inspection       (QAQC + SAFETY; items + photos cascade)
 *   - Issue            (defensive — Issue imports already wiped these)
 *   - Hindrance        (defensive)
 *   - Concern          (defensive — AOC imports already wiped these)
 *   - WorkPermit       (defensive)
 *   - SafetyInduction  (defensive)
 *   - Notification     (rows whose title or body contains the patterns)
 *
 * The Colab-imported rows (keyed on colab-* idempotency keys with
 * clean titles like "CHECKLIST FOR POWER TOOLS") don't match the
 * patterns so they're untouched. Hard delete is used so admin tools
 * don't keep showing a "soft-deleted test row" audit trail at
 * handover.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_TEST_WIPE !== "1") {
  console.error("Refusing to run: set ALLOW_TEST_WIPE=1 to run against Neon.");
  process.exit(1);
}

const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const PATTERNS = ["E2E", "TEST", "testing"];

function containsAnyPattern(field: string): Record<string, { contains: string; mode: "insensitive" }>[] {
  return PATTERNS.map((p) => ({ [field]: { contains: p, mode: "insensitive" as const } }));
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) {
    console.error(`Project not found by name: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Scanning project: ${project.name} (${project.id})`);

  // Inspection — the main offender per Shraddha's inbox screenshot
  // (E2E WIRs still visible to Thangamani). Match on title OR
  // submitRemark OR reviewerNote.
  const inspectionWhere = {
    projectId: project.id,
    OR: [
      ...containsAnyPattern("title"),
      ...containsAnyPattern("submitRemark"),
      ...containsAnyPattern("reviewerNote"),
    ],
  };
  const inspMatches = await prisma.inspection.findMany({
    where: inspectionWhere,
    select: { id: true, title: true, submitRemark: true, module: true },
  });
  console.log(`  Inspection matches: ${inspMatches.length}`);
  for (const i of inspMatches) {
    console.log(`    - ${i.module ?? "general"} · "${i.title}" (remark: ${i.submitRemark ?? "—"})`);
  }
  const inspDeleted = await prisma.inspection.deleteMany({ where: inspectionWhere });

  // Issue (Observations). Should be 0 since Issue imports wiped these,
  // but defensive matching catches anything created after the import.
  const issueWhere = {
    projectId: project.id,
    OR: containsAnyPattern("description"),
  };
  const issueMatches = await prisma.issue.count({ where: issueWhere });
  const issueDeleted = await prisma.issue.deleteMany({ where: issueWhere });

  // Hindrance / Concern — defensive.
  const hindDeleted = await prisma.hindrance.deleteMany({
    where: { projectId: project.id, OR: containsAnyPattern("description") },
  });
  const concDeleted = await prisma.concern.deleteMany({
    where: { projectId: project.id, OR: containsAnyPattern("description") },
  });

  // WorkPermit / SafetyInduction — defensive on title / workerName.
  const permitDeleted = await prisma.workPermit.deleteMany({
    where: {
      projectId: project.id,
      OR: [...containsAnyPattern("title"), ...containsAnyPattern("description")],
    },
  });
  const inductionDeleted = await prisma.safetyInduction.deleteMany({
    where: { projectId: project.id, OR: containsAnyPattern("workerName") },
  });

  // Notification — alerts tab showed test-named entries. Match on
  // title + body + url (deleted inspection ids may still linger).
  const notifDeleted = await prisma.notification.deleteMany({
    where: {
      OR: [
        ...containsAnyPattern("title"),
        ...containsAnyPattern("body"),
      ],
    },
  });

  console.log("");
  console.log("=".repeat(60));
  console.log(`Deleted Inspection:     ${inspDeleted.count}`);
  console.log(`Deleted Issue:          ${issueDeleted.count} (saw ${issueMatches} matches)`);
  console.log(`Deleted Hindrance:      ${hindDeleted.count}`);
  console.log(`Deleted Concern:        ${concDeleted.count}`);
  console.log(`Deleted WorkPermit:     ${permitDeleted.count}`);
  console.log(`Deleted SafetyInduction:${inductionDeleted.count}`);
  console.log(`Deleted Notification:   ${notifDeleted.count}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
