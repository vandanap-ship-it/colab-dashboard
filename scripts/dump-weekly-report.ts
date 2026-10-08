/**
 * One-off: dump the WeeklyReport payload the Siddhi page would render for
 * (projectId, weekEnding) to a JSON file so an external renderer (artifact,
 * one-shot HTML) can produce the exact same report when the live page is
 * misbehaving.
 *
 *   DATABASE_URL="postgresql://..." \
 *   WEEK_ENDING=2026-10-07 \
 *   npx tsx scripts/dump-weekly-report.ts
 *
 * Writes:
 *   ~/Downloads/siddhi-weekly-<weekEnding>.json
 *
 * Read-only — no writes. Safe to run against prod.
 */

import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const weekEndingStr = process.env.WEEK_ENDING ?? "2026-10-07";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEndingStr)) {
    throw new Error(`WEEK_ENDING must be YYYY-MM-DD, got "${weekEndingStr}"`);
  }

  // Lazy-require AFTER env is validated so a missing DATABASE_URL doesn't
  // crash inside Prisma init with a confusing stack.
  const { getWeeklyReport } = await import("../src/lib/weeklyReportServer");
  const { prisma } = await import("../src/lib/prisma");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found.");
  console.log(`Project: ${project.name} (${project.id})`);

  // Siddhi stores the weekEnding as a UTC-midnight day boundary.
  const weekEnding = new Date(`${weekEndingStr}T00:00:00.000Z`);
  console.log(`Week ending: ${weekEndingStr}`);

  const report = await getWeeklyReport(project.id, weekEnding);
  if (!report) {
    console.error("getWeeklyReport returned null — no report for this week.");
    process.exit(1);
  }

  const outPath = join(homedir(), "Downloads", `siddhi-weekly-${weekEndingStr}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`Payload size: ${JSON.stringify(report).length.toLocaleString()} chars`);

  // Compact summary so Vandana can eyeball the numbers before shipping.
  const summary = {
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    overall: report.overall,
    milestonePlanCount: report.milestonePlans.length,
    manpowerContractors: report.manpowerByContractor.length,
    delayReasons: report.delayReasons.length,
    dataEntryDays: report.dataEntry.length,
  };
  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
