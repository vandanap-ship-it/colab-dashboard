/**
 * One-off importer for Colab's Areas of Concern (AOC) → Siddhi Concern rows.
 * Populates the Concerns module with the team's existing open items.
 *
 *   PROJECT_NAME="Amanvana - Phase 1" \
 *   AOC_CSV=colab-aoc.csv \
 *   ALLOW_COLAB_AOC_IMPORT=1 \
 *   npx tsx scripts/import-colab-aoc.ts
 *
 * Same safety guard pattern as the other Colab importers.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_COLAB_AOC_IMPORT !== "1") {
  console.error("Refusing to run: set ALLOW_COLAB_AOC_IMPORT=1 to run against a Neon URL.");
  process.exit(1);
}

const csvPathEnv = process.env.AOC_CSV;
const projectName = process.env.PROJECT_NAME ?? "Amanvana - Phase 1";
if (!csvPathEnv || !existsSync(csvPathEnv)) {
  console.error("AOC_CSV env var required + must exist");
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

async function findUser(name: string): Promise<string | null> {
  const trimmed = name.replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unassigned") return null;
  const first = trimmed.split(" ")[0];
  const users = await prisma.user.findMany({
    where: { active: true, name: { contains: first, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const lower = trimmed.toLowerCase();
  return (
    users.find((u) => u.name.toLowerCase() === lower)?.id ??
    users.find((u) => u.name.toLowerCase().includes(lower))?.id ??
    users[0]?.id ??
    null
  );
}

/**
 * Colab date is dd/mm/yy. Parse as IST-local noon so the date lands on the
 * correct calendar day when displayed in IST.
 */
function parseColabShortDate(raw: string): Date | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
  return new Date(Date.UTC(yr, +mo - 1, +d, 12, 0, 0) - (5 * 60 + 30) * 60_000);
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) { console.error(`Project not found: ${projectName}`); process.exit(1); }

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  console.log(`Parsed ${rows.length} AOC rows`);
  const stats = { created: 0, skipped: 0, noRaiser: 0 };

  const statusMap: Record<string, string> = {
    "Pending": "PENDING",
    "Task Assigned": "TASK_ASSIGNED",
    "Completed": "COMPLETED",
    "Closed": "COMPLETED",
  };

  for (const row of rows) {
    const idempotencyKey = `colab-aoc:${row.AOC_Id}`;
    const existing = await prisma.concern.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) { stats.skipped++; continue; }

    const raisedById = await findUser(row.Created_By_User_Name);
    if (!raisedById) {
      console.warn(`  AOC ${row.AOC_Id}: no match for Created_By "${row.Created_By_User_Name}" — skipped`);
      stats.noRaiser++;
      continue;
    }
    const assignedToId = await findUser(row.Assign_User_Name);

    // Combine Issue_Name (short) + Description (long) into a single description
    // field. Colab keeps them separate; Siddhi's Concern has one field.
    const description = row.Issue_Name && row.Description
      ? `${row.Issue_Name}: ${row.Description}`
      : row.Description || row.Issue_Name || "(no description)";

    await prisma.concern.create({
      data: {
        projectId: project.id,
        description,
        status: statusMap[row.Status] ?? "PENDING",
        raisedById,
        assignedToId,
        idempotencyKey,
        createdAt: parseColabShortDate(row.Created_Date) ?? new Date(),
      },
    });
    stats.created++;
  }

  console.log(`\nCreated ${stats.created} · Skipped ${stats.skipped} · No raiser ${stats.noRaiser}`);
  const total = await prisma.concern.count({ where: { projectId: project.id, deletedAt: null } });
  console.log(`Total concerns in project: ${total}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
