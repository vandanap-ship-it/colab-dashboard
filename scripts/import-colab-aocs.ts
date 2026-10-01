/**
 * One-off importer for Colab's Areas-of-Concern (AOC) export.
 * Siddhi models these as `Concern` rows.
 *
 *   PROJECT_NAME="Amanvana" \
 *   CSV_PATH=./aocs.csv \
 *   ALLOW_AOC_IMPORT=1 \
 *   WIPE_FIRST=1 \
 *   npx tsx scripts/import-colab-aocs.ts
 *
 * Mapping:
 *   AOC_Id → idempotencyKey `colab-aoc:${AOC_Id}`
 *   Issue_Name + Description → description (one concatenated string)
 *   Status "Pending"  → PENDING
 *   Status "Resolved" → RESOLVED (speculative; not seen in sample)
 *   Created_By_User_Name → raisedById (name lookup)
 *   Assign_User_Name "Unassigned" → assignedToId null
 *   Created_Date "14/08/26" → DD/MM/YY parsed
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_AOC_IMPORT !== "1") {
  console.error("Refusing to run against Neon without ALLOW_AOC_IMPORT=1.");
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

/** "14/08/26" (DD/MM/YY) → Date (00:00 IST → UTC). "YY" expanded as 20YY. */
function parseShortDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, d, mo, yy] = m;
  const y = 2000 + Number(yy);
  const utcMs = Date.UTC(y, Number(mo) - 1, Number(d), 0, 0, 0) - (5 * 60 + 30) * 60_000;
  return new Date(utcMs);
}

async function findUserByName(name: string, cache: Map<string, string | null>): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === "unassigned") return null;
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null;
  const users = await prisma.user.findMany({
    where: { active: true, name: { contains: trimmed.split(" ")[0], mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const exact = users.find((u) => u.name.toLowerCase() === trimmed.toLowerCase());
  const partial = users.find((u) => u.name.toLowerCase().includes(trimmed.toLowerCase()));
  const first = users.find((u) => u.name.toLowerCase().startsWith(trimmed.toLowerCase()));
  const picked = exact ?? partial ?? first ?? null;
  cache.set(trimmed, picked?.id ?? null);
  return picked?.id ?? null;
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) {
    console.error(`Project not found by name: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Importing into project: ${project.name} (${project.id})`);

  const text = readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} CSV rows`);

  if (wipeFirst) {
    console.log("WIPE_FIRST=1 — wiping existing Concern (AOC) rows for this project...");
    const wiped = await prisma.concern.deleteMany({ where: { projectId: project.id } });
    console.log(`  deleted ${wiped.count} existing concerns`);
  }

  const userCache = new Map<string, string | null>();
  const stats = { created: 0, skipped_existing: 0, skipped_no_creator: 0 };

  for (const row of rows) {
    const aocId = row.AOC_Id;
    if (!aocId) continue;

    const idempotencyKey = `colab-aoc:${aocId}`;
    const existing = await prisma.concern.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_existing++;
      continue;
    }

    const raisedById = await findUserByName(row.Created_By_User_Name, userCache);
    if (!raisedById) {
      console.warn(`AOC ${aocId}: no user matches Created_By_User_Name "${row.Created_By_User_Name}" — skipped`);
      stats.skipped_no_creator++;
      continue;
    }
    const assignedToId = await findUserByName(row.Assign_User_Name, userCache);

    const descParts = [row.Issue_Name, row.Description]
      .map((s) => (s ?? "").trim()).filter(Boolean);
    const description = descParts.length > 0 ? descParts.join(" · ") : "Imported area of concern";

    const status = row.Status.trim().toUpperCase() || "PENDING";
    const createdAt = parseShortDate(row.Created_Date) ?? new Date();

    await prisma.concern.create({
      data: {
        projectId: project.id,
        description,
        status,
        raisedById,
        assignedToId,
        createdAt,
        idempotencyKey,
      },
    });
    stats.created++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:                   ${stats.created}`);
  console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
  console.log(`Skipped (no creator):      ${stats.skipped_no_creator}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
