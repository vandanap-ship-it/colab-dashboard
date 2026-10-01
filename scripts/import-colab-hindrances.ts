/**
 * One-off importer for Colab's Hindrance export.
 *
 * Colab duplicates a hindrance row per linked sub-location, so the
 * same Hindrance_ID can appear several times. Siddhi models one
 * `Hindrance` per logical blocker, so we dedupe on Hindrance_ID.
 * The idempotency key `colab-hindrance:${Hindrance_ID}` makes
 * re-runs safe.
 *
 *   PROJECT_NAME="Amanvana" \
 *   CSV_PATH=./hindrances.csv \
 *   ALLOW_HINDRANCE_IMPORT=1 \
 *   WIPE_FIRST=1 \
 *   npx tsx scripts/import-colab-hindrances.ts
 *
 * Mapping:
 *   Hindrance_Reason "Manpower shortage ..." → reasonNote (free text)
 *   Hindrance_Type   "Manpower"              → reasonCode "MANPOWER"
 *                    "Material"              → reasonCode "MATERIAL"
 *                    "RMC"                   → reasonCode "RMC"
 *                    other                   → reasonCode (uppercased)
 *   Hindrance_Start_Date "21-06-2026 09:30:00" → startDate (IST → UTC)
 *   Hindrance_End_Date   → endDate; resolvedDate set to same value
 *   status: OPEN if endDate blank, else CLOSED
 *   Contractor "NA-Abraham Thomas" → responsibleContractorId
 *   createdById: the ambient execution manager — defaults to the first
 *                active user whose designation includes "Execution" or
 *                "DPM". Hindrances don't carry a reporter in the Colab
 *                CSV, so we attribute to the execution lead so the row
 *                can be opened.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_HINDRANCE_IMPORT !== "1") {
  console.error("Refusing to run against Neon without ALLOW_HINDRANCE_IMPORT=1.");
  process.exit(1);
}

const csvPathEnv = process.env.CSV_PATH;
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const wipeFirst = process.env.WIPE_FIRST === "1";
if (!csvPathEnv) {
  console.error("CSV_PATH env var required");
  process.exit(1);
}
if (!existsSync(csvPathEnv)) {
  console.error(`CSV not found: ${csvPathEnv}`);
  process.exit(1);
}
const csvPath: string = csvPathEnv;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { cur.push(field); field = ""; continue; }
    if (ch === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); lines.push(cur); }
  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1)
    .filter((row) => row.some((c) => c.trim().length > 0))
    .map((row) => Object.fromEntries(header.map((h, i) => [h, (row[i] ?? "").trim()])));
}

function normalizeContractorName(raw: string): string {
  if (!raw) return "";
  const stripped = raw.includes("-") ? raw.split("-").slice(1).join("-") : raw;
  const collapsed = stripped.trim().replace(/\s+/g, " ");
  return collapsed
    .split(" ")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** "21-06-2026 09:30:00" (DD-MM-YYYY HH:MM:SS) → Date (IST → UTC) */
function parseDateTime(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  const utcMs =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) -
    (5 * 60 + 30) * 60_000;
  return new Date(utcMs);
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) {
    console.error(`Project not found by name: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Importing into project: ${project.name} (${project.id})`);

  // Pick an execution-side user as the ambient creator. First match on
  // designation containing "Execution" or "DPM" (Harish is a DPM, Madhavan
  // an Assistant Manager - Execution).
  const executor = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { designation: { contains: "Execution", mode: "insensitive" } },
        { designation: { contains: "DPM", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!executor) {
    console.error("No execution-side user found. Create one before importing hindrances.");
    process.exit(1);
  }
  console.log(`Attributing hindrances to: ${executor.name} (${executor.id})`);

  const text = readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} CSV rows`);

  if (wipeFirst) {
    console.log("WIPE_FIRST=1 — wiping existing Hindrance rows for this project...");
    const wiped = await prisma.hindrance.deleteMany({ where: { projectId: project.id } });
    console.log(`  deleted ${wiped.count} existing hindrances`);
  }

  const stats = {
    created: 0,
    skipped_existing: 0,
    skipped_duplicate_in_csv: 0,
    missing_contractor: 0,
  };
  const seenInRun = new Set<string>();

  for (const row of rows) {
    const hid = row.Hindrance_ID;
    if (!hid) continue;
    if (seenInRun.has(hid)) {
      stats.skipped_duplicate_in_csv++;
      continue;
    }
    seenInRun.add(hid);

    const idempotencyKey = `colab-hindrance:${hid}`;
    const existing = await prisma.hindrance.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_existing++;
      continue;
    }

    const startDate = parseDateTime(row.Hindrance_Start_Date);
    if (!startDate) {
      console.warn(`Hindrance ${hid}: bad Hindrance_Start_Date "${row.Hindrance_Start_Date}" — skipped`);
      continue;
    }
    const endDate = parseDateTime(row.Hindrance_End_Date);

    const typeNormalized = row.Hindrance_Type.trim().toUpperCase().replace(/\s+/g, "_");

    const normalizedContractor = normalizeContractorName(row.Contractor);
    let responsibleContractorId: string | null = null;
    if (normalizedContractor) {
      const c = await prisma.contractor.findFirst({
        where: { projectId: project.id, name: { equals: normalizedContractor, mode: "insensitive" } },
        select: { id: true },
      });
      responsibleContractorId = c?.id ?? null;
      if (!responsibleContractorId) stats.missing_contractor++;
    }

    await prisma.hindrance.create({
      data: {
        projectId: project.id,
        description: row.Description || "Imported hindrance",
        startDate,
        endDate,
        resolvedDate: endDate,
        status: endDate ? "CLOSED" : "OPEN",
        reasonCode: typeNormalized || null,
        reasonNote: row.Hindrance_Reason || null,
        responsibleContractorId,
        createdById: executor.id,
        createdAt: parseDateTime(row.Hindrance_System_Creation_Date) ?? startDate,
        idempotencyKey,
      },
    });
    stats.created++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:                   ${stats.created}`);
  console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
  console.log(`Skipped (dup in CSV):      ${stats.skipped_duplicate_in_csv}`);
  console.log(`Missing contractor link:   ${stats.missing_contractor}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
