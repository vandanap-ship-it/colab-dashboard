/**
 * MSP CSV → Prisma importer (CLI wrapper).
 *
 * The heavy lifting lives in src/lib/mspImport.ts so the same code powers
 * both this CLI and the /api/admin/import-msp route. This wrapper only:
 *   - parses CLI args
 *   - reads the CSV from disk
 *   - opens a pg-adapter Prisma client bound to DATABASE_URL
 *   - prints a formatted summary
 *
 * Usage:
 *   pnpm tsx scripts/import-msp.ts \
 *     --csv scratchpad-data/amanvana_msp.csv \
 *     --project "Amanvana" \
 *     --creator admin
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { importMspCsv } from "@/lib/mspImport";

interface CliArgs {
  csv: string;
  project: string;
  creator: string;
  onlyVillas?: number[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: Record<string, string> = { creator: "admin" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--csv") out.csv = args[++i];
    else if (a === "--project") out.project = args[++i];
    else if (a === "--creator") out.creator = args[++i];
    else if (a === "--only-villas") out.onlyVillas = args[++i];
  }
  if (!out.csv) out.csv = "scratchpad-data/amanvana_msp.csv";
  if (!out.project) out.project = "Amanvana";
  const parsed: CliArgs = {
    csv: out.csv,
    project: out.project,
    creator: out.creator,
  };
  if (out.onlyVillas) {
    const nums = out.onlyVillas
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (nums.length === 0) {
      console.error("✗ --only-villas provided but no valid numbers parsed");
      process.exit(1);
    }
    parsed.onlyVillas = nums;
  }
  return parsed;
}

async function main() {
  const { csv, project, creator, onlyVillas } = parseArgs();
  const csvAbs = path.resolve(process.cwd(), csv);
  if (!fs.existsSync(csvAbs)) {
    console.error(`✗ CSV not found: ${csvAbs}`);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is required");
    process.exit(1);
  }

  console.log(`── MSP Importer ──`);
  console.log(`  CSV      ${csvAbs}`);
  console.log(`  Project  ${project}`);
  console.log(`  Creator  ${creator}`);
  if (onlyVillas) console.log(`  Villas   ${onlyVillas.join(", ")} (scoped)`);
  console.log(``);

  const csvText = fs.readFileSync(csvAbs, "utf-8");
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  const t0 = Date.now();
  let stats;
  try {
    stats = await importMspCsv(prisma, {
      csvText,
      projectName: project,
      creatorUsername: creator,
      onlyVillas,
    });
  } finally {
    await prisma.$disconnect();
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(``);
  console.log(`── Done in ${secs}s ──`);
  console.log(`  Project          ${stats.projectName} (${stats.projectId?.slice(0, 8)}...)`);
  console.log(`  Rows read        ${stats.totalRows}`);
  console.log(`  Physical units   ${stats.totalUnits}`);
  console.log(`  Blocks           ${stats.blocks.created} created · ${stats.blocks.updated} updated`);
  console.log(`  Villas           ${stats.villas.created} created · ${stats.villas.updated} updated`);
  console.log(`  Sections         ${stats.sections.created} created · ${stats.sections.updated} updated`);
  console.log(`  Villa milestones ${stats.villaMilestones.created} created · ${stats.villaMilestones.updated} updated`);
  console.log(`  WBS nodes        ${stats.wbsNodes.created} created · ${stats.wbsNodes.updated} updated`);
  if (stats.skipped.rows > 0) {
    console.log(`  Skipped rows     ${stats.skipped.rows}`);
    for (const [reason, count] of Object.entries(stats.skipped.reasons)) {
      console.log(`    · ${reason}: ${count}`);
    }
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
