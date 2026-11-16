/**
 * One-shot backfill for the 2026-11-04 management-review rule change:
 * shorten the Safety Induction validity window from 12 months to 6 months
 * across every existing SafetyInduction row.
 *
 * DRY RUN by default. Prints:
 *   - how many rows would get a new (earlier) expiryDate
 *   - how many rows would flip to EXPIRED on the next cron run
 *   - a sample of the newly-expired rows (displayId, worker, inductionDate,
 *     old expiryDate, new expiryDate) so you can sanity-check before
 *     committing
 *
 * Apply with:
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" COMMIT=1 \
 *     npx tsx --env-file=.env.local scripts/backfill-induction-expiry-6mo.ts
 *
 * Dry run (default):
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" \
 *     npx tsx --env-file=.env.local scripts/backfill-induction-expiry-6mo.ts
 *
 * Idempotent: computes the new expiryDate from inductionDate, so re-running
 * after a successful apply changes nothing. Soft-deleted rows are
 * skipped. The cron that flips APPROVED past-expiry rows to EXPIRED picks
 * up from here on the next wake-up - this script does NOT flip status
 * itself, only shifts the expiryDate column.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeInductionExpiry } from "../src/lib/safetyInduction";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const commit = process.env.COMMIT === "1";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }

  console.log(`Project: ${project.name}`);
  console.log(`Mode:    ${commit ? "APPLY" : "DRY RUN"}\n`);

  const inductions = await prisma.safetyInduction.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { inductionDate: "asc" },
    select: {
      id: true,
      displayId: true,
      workerName: true,
      inductionDate: true,
      expiryDate: true,
      status: true,
    },
  });

  const now = new Date();
  const changes = inductions.map((i) => {
    const newExpiry = computeInductionExpiry(i.inductionDate);
    const willExpireNow = i.status === "APPROVED" && newExpiry < now && i.expiryDate >= now;
    const alreadyAtTarget = Math.abs(newExpiry.getTime() - i.expiryDate.getTime()) < 1000;
    return { row: i, newExpiry, willExpireNow, alreadyAtTarget };
  });

  const toUpdate = changes.filter((c) => !c.alreadyAtTarget);
  const willExpireNow = changes.filter((c) => c.willExpireNow);
  const alreadyExpired = changes.filter((c) => c.row.status === "EXPIRED");
  const stillValid = changes.filter((c) => c.row.status === "APPROVED" && c.newExpiry >= now);

  console.log(`Total inductions (non-deleted): ${inductions.length}`);
  console.log(`  already at 6-month target:    ${inductions.length - toUpdate.length}`);
  console.log(`  rows the backfill will shift: ${toUpdate.length}\n`);

  console.log(`Of the shifted rows:`);
  console.log(`  flip to EXPIRED on next cron run (APPROVED today → past 6mo mark): ${willExpireNow.length}`);
  console.log(`  still valid under new 6-month rule (APPROVED):                     ${stillValid.length}`);
  console.log(`  already EXPIRED in DB (no state change):                           ${alreadyExpired.length}\n`);

  if (willExpireNow.length > 0) {
    console.log(`Sample of rows that WILL flip to EXPIRED (up to 20):`);
    console.log(`  displayId    inductionDate  old expiry   new expiry   worker`);
    for (const c of willExpireNow.slice(0, 20)) {
      console.log(
        `  ${c.row.displayId.padEnd(12)} ${iso(c.row.inductionDate)}   ${iso(c.row.expiryDate)}  ${iso(c.newExpiry)}   ${c.row.workerName}`,
      );
    }
    if (willExpireNow.length > 20) {
      console.log(`  ... ${willExpireNow.length - 20} more`);
    }
    console.log();
  }

  if (!commit) {
    console.log("DRY RUN - nothing written. Re-run with COMMIT=1 to apply.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Applying ${toUpdate.length} updates...`);
  // Chunk the updates so we don't hold one giant transaction open; 100-row
  // chunks keep Neon happy on slow links and let a partial failure surface
  // which chunk broke.
  const chunkSize = 100;
  let done = 0;
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((c) =>
        prisma.safetyInduction.update({
          where: { id: c.row.id },
          data: { expiryDate: c.newExpiry },
        }),
      ),
    );
    done += chunk.length;
    console.log(`  ${done} / ${toUpdate.length}`);
  }
  console.log(`\nDone. The nightly induction-expiry cron will flip the ${willExpireNow.length} newly-past-due rows to EXPIRED on its next run (or trigger /api/cron/induction-expiry now to flip immediately).`);

  await prisma.$disconnect();
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

main().catch((e) => { console.error(e); process.exit(1); });
