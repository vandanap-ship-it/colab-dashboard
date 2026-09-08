/**
 * One-off importer for Colab's historical work-permit export.
 *
 * Reads a CSV in the exact shape Colab produces (see the sample in
 * /Users/.../Downloads/20260908_*.csv) and creates WorkPermit rows in
 * Siddhi's DB. Idempotent by the CSV's `id` column — re-running skips
 * rows already imported.
 *
 *   PROJECT_NAME="Amanvana - Phase 1" \
 *   CSV_PATH=./work-permits.csv \
 *   npx tsx scripts/import-work-permits.ts
 *
 * Also refuses to run against a Neon URL without ALLOW_WORK_PERMIT_IMPORT=1
 * — matches the guards on seed.ts / demo-seed.ts. Historical data
 * import is a bulk-write action; nobody should hit it accidentally.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { serializeApproverIds, type WorkPermitStatus, type WorkPermitType } from "../src/lib/workPermit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_WORK_PERMIT_IMPORT !== "1") {
  console.error(
    "Refusing to run: DATABASE_URL points at a Neon host.\n" +
    "Set ALLOW_WORK_PERMIT_IMPORT=1 to run against a Neon branch on purpose.",
  );
  process.exit(1);
}

const csvPathEnv = process.env.CSV_PATH;
const projectName = process.env.PROJECT_NAME ?? "Amanvana - Phase 1";
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

/**
 * Bare-bones CSV parser that handles quoted fields with commas inside them
 * (the Colab export uses "Abhishek R Mane, Girish R" for multi-approver
 * rows). Avoids pulling in a CSV lib for one script.
 */
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

const TYPE_MAP: Record<string, WorkPermitType> = {
  "Hot Work": "HOT_WORK",
  "Deshuttering": "DESHUTTERING",
  "De-shuttering": "DESHUTTERING",
  "Night Work / Holiday": "NIGHT_WORK",
  "General Work Permit": "GENERAL",
};

/**
 * Convert Colab's pandas-Timedelta-style "0 days 15:32:00" → "15:32".
 * Empty / unparseable input returns null so the caller can decide a default.
 */
function parseTime(raw: string): string | null {
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

/**
 * "02 Jul 2026 , 03:36 PM" → Date. Also accepts the ISO-ish `permit_date`
 * ("2026-07-02"). Returns null on unparseable input — caller uses workDate
 * fallback for those.
 */
function parseWhenLike(raw: string): Date | null {
  if (!raw) return null;
  // Try the "02 Jul 2026 , 03:36 PM" shape first.
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*,\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (m) {
    const [, d, mon, yr, hh, mm, ampm] = m;
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const monthIdx = months[mon];
    if (monthIdx == null) return null;
    let hour = Number(hh);
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    // IST — treat the local time as Asia/Kolkata by subtracting 5:30 to store UTC.
    const utcMs = Date.UTC(Number(yr), monthIdx, Number(d), hour, Number(mm)) - (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  // ISO fallback
  const iso = new Date(raw);
  return isNaN(iso.getTime()) ? null : iso;
}

async function findUserByName(name: string, cache: Map<string, string | null>): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null;
  // The CSV uses free-text names ("Abraham T", "Abhishek R Mane"). We try to
  // match by prefix first, then by any-word substring; skip if none match.
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
  name: string,
  projectId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null;
  const c = await prisma.contractor.findFirst({
    where: { projectId, name: { contains: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  cache.set(trimmed, c?.id ?? null);
  return c?.id ?? null;
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

  const userCache = new Map<string, string | null>();
  const contractorCache = new Map<string, string | null>();

  // Idempotency: each Colab row's `id` becomes our idempotencyKey so
  // re-running the script skips already-imported permits.
  const stats = { created: 0, skipped: 0, unmatchedRequester: 0, unmatchedType: 0 };

  for (const row of rows) {
    const csvId = row.id;
    const idempotencyKey = `colab-permit:${csvId}`;
    const existing = await prisma.workPermit.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) { stats.skipped++; continue; }

    const type = TYPE_MAP[row.permit_type];
    if (!type) {
      console.warn(`Row ${csvId}: unknown permit_type "${row.permit_type}" — skipped`);
      stats.unmatchedType++;
      continue;
    }

    const requesterId = await findUserByName(row.trigger_by, userCache);
    if (!requesterId) {
      console.warn(`Row ${csvId}: no user matches trigger_by "${row.trigger_by}" — skipped`);
      stats.unmatchedRequester++;
      continue;
    }

    // Approvers = split individual_approver_name on comma, look each up.
    // Names that don't resolve are simply dropped — the row still imports
    // as long as at least one approver was found (else fall back to an
    // empty list, permit stays PENDING with no approver options).
    const approverIds: string[] = [];
    for (const approverName of row.individual_approver_name.split(",")) {
      const uid = await findUserByName(approverName, userCache);
      if (uid && !approverIds.includes(uid)) approverIds.push(uid);
    }

    const workDate = parseWhenLike(row.permit_date) ?? new Date(row.permit_date);
    const startTime = parseTime(row.start_time) ?? "09:00";
    const endTime = parseTime(row.end_time) ?? "18:00";

    // Status inference from Colab timestamps:
    //   permit_close_date set → CLOSED
    //   approved_by set + no close → APPROVED
    //   else                     → PENDING
    let status: WorkPermitStatus = "PENDING";
    let approvedById: string | null = null;
    let approvedAt: Date | null = null;
    let closedById: string | null = null;
    let closedAt: Date | null = null;
    const approvedByCsv = row.approved_by?.trim();
    if (approvedByCsv) {
      approvedById = await findUserByName(approvedByCsv, userCache);
      approvedAt = parseWhenLike(row.permit_created_at) ?? workDate;
      status = "APPROVED";
    }
    if (row.permit_close_date?.trim()) {
      status = "CLOSED";
      closedById = approvedById ?? requesterId;
      closedAt = parseWhenLike(row.permit_close_timestamp) ?? workDate;
      // If approved_by was blank but close_date was set, backfill an
      // approval marker so the row makes sense downstream.
      if (!approvedById) {
        approvedById = closedById;
        approvedAt = closedAt;
      }
    }

    const contractorId = await findContractorByName(
      row.trigger_by_contractor_company_name,
      project.id,
      contractorCache,
    );

    const locationParts = [row.location_name, row.sub_location_name, row.sub_sub_location_name]
      .map((s) => s?.trim())
      .filter((s): s is string => Boolean(s) && s !== "-");
    const location = locationParts.length > 0 ? locationParts.join(" / ") : null;

    await prisma.workPermit.create({
      data: {
        projectId: project.id,
        type,
        title: row.permit_name || `${type} PERMIT`,
        description: row.description || null,
        workDate,
        startTime,
        endTime,
        location,
        contractorId,
        requesterId,
        approverIds: serializeApproverIds(approverIds),
        status,
        approvedById,
        approvedAt,
        closedById,
        closedAt,
        idempotencyKey,
        createdAt: parseWhenLike(row.permit_created_at) ?? new Date(),
      },
    });
    stats.created++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:              ${stats.created}`);
  console.log(`Skipped (already in): ${stats.skipped}`);
  console.log(`Skipped (bad type):   ${stats.unmatchedType}`);
  console.log(`Skipped (no user):    ${stats.unmatchedRequester}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
