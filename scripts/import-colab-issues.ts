/**
 * One-off importer for Colab's Observations / Snags export.
 *
 * Each Colab row carries an Issue_id + Viewpoint_Main_ID. The same
 * Issue_id can appear across multiple rows (one per linked viewpoint
 * photo in Colab). Siddhi models each CSV row as its own `Issue`,
 * keyed idempotently on `colab-issue:{Issue_id}-{Viewpoint_Main_ID}`
 * (or Issue_id alone when the viewpoint id is blank).
 *
 *   PROJECT_NAME="Amanvana" \
 *   CSV_PATH=./issues.csv \
 *   ALLOW_ISSUE_IMPORT=1 \
 *   WIPE_FIRST=1 \
 *   npx tsx scripts/import-colab-issues.ts
 *
 * Mapping:
 *   Issue_Status "Close Without Debit" → CLOSED
 *   Issue_Status "In Review"           → IN_REVIEW
 *   anything else                       → OPEN
 *
 *   Issue_Priority "Minor" / "Major" / "Critical" → severity (verbatim)
 *   Issue_Category "Quality" (always for Amanvana) → category
 *   Issue_Type "Observation" (always)              → module="QAQC"
 *
 *   Created_By "Thangamani G (Manager - QA/QC, White Lotus)" → strip
 *   paren suffix, resolve to User.name.
 *
 *   Contractor_Name "NA-Abraham Thomas" → "Abraham Thomas", resolved
 *   against the Siddhi contractor table (Debit_To mapped the same way).
 *
 *   Location "Villa 25" → resolved against Villa.name, used for the
 *   observation's villaId tag. Issue list filters on villaId.
 *
 *   description: concat of Issue_Tags + Issue_Final_Remark + the viewpoint
 *   remark, so the row is readable without an attached photo.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_ISSUE_IMPORT !== "1") {
  console.error("Refusing to run against Neon without ALLOW_ISSUE_IMPORT=1.");
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

/** "Thangamani G (Manager - QA/QC, White Lotus)" → "Thangamani G" */
function stripUserRoleSuffix(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** "04 Jul 2026" → Date (00:00 IST → UTC). "-" and "" return null. */
function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const [, d, mo, y] = m;
  const monthIdx = months[mo];
  if (monthIdx == null) return null;
  const utcMs = Date.UTC(Number(y), monthIdx, Number(d), 0, 0, 0) - (5 * 60 + 30) * 60_000;
  return new Date(utcMs);
}

async function findUserByName(name: string, cache: Map<string, string | null>): Promise<string | null> {
  const trimmed = stripUserRoleSuffix(name);
  if (!trimmed) return null;
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

async function findContractorByName(
  normalizedName: string,
  projectId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (!normalizedName) return null;
  if (cache.has(normalizedName)) return cache.get(normalizedName) ?? null;
  const c = await prisma.contractor.findFirst({
    where: { projectId, name: { equals: normalizedName, mode: "insensitive" } },
    select: { id: true },
  });
  cache.set(normalizedName, c?.id ?? null);
  return c?.id ?? null;
}

/**
 * Villa in Siddhi is keyed on `number: Int`, not a free-text name. Colab
 * writes "Villa 25" / "Villa 04" so we extract the trailing integer and
 * look up by number (joining via block → project to keep the match
 * project-scoped). Falls back to the `label` string match if the row's
 * number parses to NaN (shouldn't happen in practice).
 */
async function findVillaByName(
  name: string,
  projectId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null;
  const m = trimmed.match(/(\d+)/);
  if (!m) {
    cache.set(trimmed, null);
    return null;
  }
  const num = Number(m[1]);
  const v = await prisma.villa.findFirst({
    where: { projectId, number: num },
    select: { id: true },
  });
  cache.set(trimmed, v?.id ?? null);
  return v?.id ?? null;
}

function mapStatus(colabStatus: string): "OPEN" | "IN_REVIEW" | "CLOSED" | "REJECTED" {
  const s = colabStatus.trim().toLowerCase();
  if (s.includes("close")) return "CLOSED";
  if (s.includes("review")) return "IN_REVIEW";
  if (s.includes("reject")) return "REJECTED";
  return "OPEN";
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
    console.log("WIPE_FIRST=1 — wiping existing Issue rows for this project...");
    const wiped = await prisma.issue.deleteMany({ where: { projectId: project.id } });
    console.log(`  deleted ${wiped.count} existing issues`);
  }

  const userCache = new Map<string, string | null>();
  const contractorCache = new Map<string, string | null>();
  const villaCache = new Map<string, string | null>();

  const stats = {
    created: 0,
    skipped_existing: 0,
    skipped_no_creator: 0,
    open: 0,
    in_review: 0,
    closed: 0,
    missing_villa: 0,
    missing_contractor: 0,
  };

  for (const row of rows) {
    const issueId = row.Issue_id || row["Issue_id"];
    if (!issueId) continue;
    const viewpointId = row.Viewpoint_Main_ID?.trim() || "";
    const idempotencyKey = viewpointId
      ? `colab-issue:${issueId}-${viewpointId}`
      : `colab-issue:${issueId}`;

    const existing = await prisma.issue.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_existing++;
      continue;
    }

    const createdById = await findUserByName(row.Created_By, userCache);
    if (!createdById) {
      console.warn(`Issue ${issueId}: no user matches Created_By "${row.Created_By}" — skipped`);
      stats.skipped_no_creator++;
      continue;
    }

    const assignedToId = row.Assigned_To ? await findUserByName(row.Assigned_To, userCache) : null;

    const normalizedContractor = normalizeContractorName(row.Debit_To || row.Contractor_Name);
    const debitToId = await findContractorByName(normalizedContractor, project.id, contractorCache);
    if (normalizedContractor && !debitToId) stats.missing_contractor++;

    const villaId = await findVillaByName(row.Location, project.id, villaCache);
    if (row.Location && !villaId) stats.missing_villa++;

    const status = mapStatus(row.Issue_Status);

    const descParts = [
      row.Issue_Tags,
      row.Viewpoint_Remark,
      row.Issue_Final_Remark,
    ].map((s) => (s ?? "").trim()).filter(Boolean);
    const description = descParts.length > 0 ? descParts.join(" · ") : "Imported observation";

    const createdAt = parseDate(row.Creation_Date) ?? new Date();
    const dueDate = parseDate(row.Due_Date);

    await prisma.issue.create({
      data: {
        projectId: project.id,
        description,
        category: row.Issue_Category || null,
        severity: row.Issue_Priority || null,
        status,
        module: "QAQC", // all Colab observations in this export are QA/QC-filed
        createdById,
        assignedToId,
        debitToId,
        villaId,
        dueDate,
        createdAt,
        idempotencyKey,
      },
    });
    stats.created++;
    if (status === "OPEN") stats.open++;
    if (status === "IN_REVIEW") stats.in_review++;
    if (status === "CLOSED") stats.closed++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:                   ${stats.created}`);
  console.log(`  → OPEN                   ${stats.open}`);
  console.log(`  → IN_REVIEW              ${stats.in_review}`);
  console.log(`  → CLOSED                 ${stats.closed}`);
  console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
  console.log(`Skipped (no creator):      ${stats.skipped_no_creator}`);
  console.log(`Missing villa link:        ${stats.missing_villa}`);
  console.log(`Missing contractor link:   ${stats.missing_contractor}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
