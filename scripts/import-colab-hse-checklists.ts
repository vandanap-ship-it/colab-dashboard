/**
 * One-off importer for Colab's HSE Checklist (EHS Inspection) export.
 *
 * Reads the CSV Colab produces (columns: project_name, trigger_id,
 * checklist_name, category, status, location, sub_location,
 * sub_sub_location, exact_location, activity_head, activity,
 * trigger_type, triggered_by, contractor_name, triggered_timestamp,
 * approved_date, rejected_date, remark, approved_remark, reject_remark,
 * reject_count, approval_level, checklist_phase, rank_1_approver,
 * activity_id, ...) and creates `Inspection` rows in Siddhi's DB with
 * module="SAFETY". Idempotent by the CSV's trigger_id, which lands on
 * idempotencyKey.
 *
 *   PROJECT_NAME="Amanvana" \
 *   CSV_PATH=./hse-checklists.csv \
 *   ALLOW_HSE_CHECKLIST_IMPORT=1 \
 *   WIPE_FIRST=1 \                # optional — delete existing SAFETY rows first
 *   npx tsx scripts/import-colab-hse-checklists.ts
 *
 * Modeling notes:
 *   - Colab's rank_1_approver cell often carries a date suffix:
 *     "Girish R (01-10-2026)". We strip the parenthetical before the
 *     name lookup, then preserve the date as reviewedAt.
 *   - Inspection items (per-checkpoint rows the mobile form captures)
 *     aren't in the Colab CSV. The import creates the Inspection
 *     parent only — items stay empty. That matches how Siddhi handles
 *     historical imports: the record exists in the list, approved/
 *     pending state is correct, items are backfilled by the site team
 *     only if they re-open the checklist.
 *   - Status mapping:
 *       Approved → PASSED, reviewedAt from approved_date
 *       Rejected → REJECTED, reviewedAt from rejected_date,
 *                  rejectionReason from reject_remark
 *       New / Open / empty → IN_REVIEW
 *   - Only rows whose project_name matches PROJECT_NAME are imported.
 *     Everything else is skipped silently with the count surfaced.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_HSE_CHECKLIST_IMPORT !== "1") {
  console.error(
    "Refusing to run: DATABASE_URL points at a Neon host.\n" +
    "Set ALLOW_HSE_CHECKLIST_IMPORT=1 to run against a Neon branch on purpose.",
  );
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

/**
 * Vendor-prefix strip + title case, same as the induction importer so
 * "Elegant-Elegant Constructions" and "NA-Abraham Thomas" both resolve
 * cleanly against the Siddhi contractor table.
 */
function normalizeContractorName(raw: string): string {
  if (!raw) return "";
  const stripped = raw.includes("-") ? raw.split("-").slice(1).join("-") : raw;
  const collapsed = stripped.trim().replace(/\s+/g, " ");
  return collapsed
    .split(" ")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * "01-10-2026 17:44:17" (DD-MM-YYYY HH:MM:SS) → Date (IST → UTC).
 * Falls back to any ISO-parseable value, else null.
 */
function parseTimestamp(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, d, mo, y, hh, mm, ss] = m;
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) -
      (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  const iso = new Date(raw);
  return isNaN(iso.getTime()) ? null : iso;
}

/**
 * "01-10-2026" (DD-MM-YYYY date-only) → Date at 00:00 IST → UTC.
 */
function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0) - (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  return parseTimestamp(raw);
}

/**
 * "Girish R (01-10-2026)" → "Girish R". Leaves plain names alone.
 */
function stripApproverDateSuffix(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

async function findUserByName(name: string, cache: Map<string, string | null>): Promise<string | null> {
  const trimmed = name.trim();
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

async function resolveOrCreateContractor(
  normalizedName: string,
  projectId: string,
  cache: Map<string, string | null>,
  createIfMissing: boolean,
): Promise<string | null> {
  if (!normalizedName) return null;
  if (cache.has(normalizedName)) return cache.get(normalizedName) ?? null;
  const existing = await prisma.contractor.findFirst({
    where: { projectId, name: { equals: normalizedName, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    cache.set(normalizedName, existing.id);
    return existing.id;
  }
  if (!createIfMissing) {
    cache.set(normalizedName, null);
    return null;
  }
  const created = await prisma.contractor.create({
    data: { projectId, name: normalizedName, category: "Labour Supply", active: true },
    select: { id: true },
  });
  console.log(`  + created contractor on the fly: "${normalizedName}" (${created.id})`);
  cache.set(normalizedName, created.id);
  return created.id;
}

type SiddhiStatus = "IN_REVIEW" | "PASSED" | "REJECTED";

function mapStatus(colabStatus: string): SiddhiStatus {
  const s = colabStatus.trim().toLowerCase();
  if (s === "approved") return "PASSED";
  if (s === "rejected") return "REJECTED";
  // "New", "Open", "" all collapse to IN_REVIEW
  return "IN_REVIEW";
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
    console.log("WIPE_FIRST=1 — wiping existing Inspection rows with module=SAFETY for this project...");
    // InspectionItem + InspectionPhoto rows cascade via Prisma onDelete (verified in schema)
    const wiped = await prisma.inspection.deleteMany({
      where: { projectId: project.id, module: "SAFETY" },
    });
    console.log(`  deleted ${wiped.count} existing SAFETY inspections`);
  }

  const userCache = new Map<string, string | null>();
  const contractorCache = new Map<string, string | null>();

  const stats = {
    created: 0,
    skipped_existing: 0,
    skipped_wrong_project: 0,
    skipped_no_filler: 0,
    passed: 0,
    rejected: 0,
    in_review: 0,
    missing_reviewer: 0,
    missing_contractor: 0,
  };

  for (const row of rows) {
    const triggerId = row.trigger_id;
    if (!triggerId) continue;

    // Skip rows from other projects (shouldn't happen for Amanvana but defensive).
    if (row.project_name && row.project_name.trim().toLowerCase() !== projectName.toLowerCase()) {
      stats.skipped_wrong_project++;
      continue;
    }

    const idempotencyKey = `colab-hse-check:${triggerId}`;
    const existing = await prisma.inspection.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_existing++;
      continue;
    }

    const filledById = await findUserByName(row.triggered_by, userCache);
    if (!filledById) {
      console.warn(`Row trigger_id=${triggerId}: no user matches triggered_by "${row.triggered_by}" — skipped`);
      stats.skipped_no_filler++;
      continue;
    }

    const status = mapStatus(row.status);

    // Reviewer resolution: strip the "(date)" suffix if present, then
    // look up by name. Missing reviewer is non-fatal — the row still
    // imports with reviewedById=null, status may still be PASSED
    // (preserving the Colab decision) but the Siddhi UI will show
    // "reviewer unknown" on that row.
    let reviewedById: string | null = null;
    if (row.rank_1_approver) {
      const bareName = stripApproverDateSuffix(row.rank_1_approver);
      reviewedById = await findUserByName(bareName, userCache);
      if (!reviewedById) stats.missing_reviewer++;
    }

    const normalizedContractor = normalizeContractorName(row.contractor_name);
    // Don't create new contractors from checklist rows — those names
    // ("Manual Checklist", "Abhishek R Mane") are often CSV-parse
    // artefacts from quoted commas, not real contractors.
    const contractorId = await resolveOrCreateContractor(
      normalizedContractor,
      project.id,
      contractorCache,
      false,
    );
    if (normalizedContractor && !contractorId) stats.missing_contractor++;

    const createdAt = parseTimestamp(row.triggered_timestamp) ?? new Date();
    const reviewedAt =
      status === "PASSED"
        ? parseDate(row.approved_date) ?? createdAt
        : status === "REJECTED"
          ? parseDate(row.rejected_date) ?? createdAt
          : null;

    // Build exactLocation from the 4 location columns: location /
    // sub_location / sub_sub_location / exact_location. Each is kept
    // only if it carries real content.
    const locationParts = [row.location, row.sub_location, row.sub_sub_location, row.exact_location]
      .map((s) => (s ?? "").trim())
      .filter((s) => s.length > 0 && s !== "-" && s.toLowerCase() !== "all locations");
    const exactLocation = locationParts.length > 0 ? locationParts.join(" / ") : null;

    await prisma.inspection.create({
      data: {
        projectId: project.id,
        title: row.checklist_name || "Imported HSE Checklist",
        module: "SAFETY",
        status,
        filledById,
        reviewedById,
        reviewedAt,
        contractorId,
        exactLocation,
        submitRemark: row.remark || null,
        reviewerNote: status === "PASSED" ? row.approved_remark || null : null,
        rejectionReason: status === "REJECTED" ? row.reject_remark || null : null,
        triggerType: row.trigger_type?.toLowerCase().includes("manual") ? "Manual" : "Auto",
        createdAt,
        idempotencyKey,
      },
    });
    stats.created++;
    if (status === "PASSED") stats.passed++;
    if (status === "REJECTED") stats.rejected++;
    if (status === "IN_REVIEW") stats.in_review++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:                   ${stats.created}`);
  console.log(`  → PASSED                 ${stats.passed}`);
  console.log(`  → REJECTED               ${stats.rejected}`);
  console.log(`  → IN_REVIEW              ${stats.in_review}`);
  console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
  console.log(`Skipped (wrong project):   ${stats.skipped_wrong_project}`);
  console.log(`Skipped (no filler match): ${stats.skipped_no_filler}`);
  console.log(`Reviewer unresolved:       ${stats.missing_reviewer}`);
  console.log(`Contractor unresolved:     ${stats.missing_contractor}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
