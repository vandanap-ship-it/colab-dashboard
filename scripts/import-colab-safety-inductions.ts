/**
 * One-off importer for Colab's Safety Induction (HSE Induction) export.
 *
 * Reads the CSV Colab produces (columns: safety_induction_id,
 * contractor_name, labour_name, trade, form_submission_date, status,
 * pending_approval_level, pending_with_users, pending_teams, hse_status,
 * health_status, site_status, project_name) and creates SafetyInduction
 * rows in Siddhi's DB. Idempotent by the CSV's EP-XXXXX id, which lands
 * on both idempotencyKey and displayId.
 *
 *   PROJECT_NAME="Amanvana" \
 *   CSV_PATH=./inductions.csv \
 *   ALLOW_INDUCTION_IMPORT=1 \
 *   WIPE_FIRST=1 \                # optional — delete existing project rows first
 *   npx tsx scripts/import-colab-safety-inductions.ts
 *
 * The Neon guard mirrors import-work-permits.ts. A bulk safety-induction
 * wipe + reimport should never happen by accident.
 *
 * Modeling notes:
 *   - Colab's export lacks worker photo / aadhaar / signature URLs.
 *     Siddhi's schema allows those null. The on-site team will backfill
 *     photos the next time they re-interact with the induction (e.g. a
 *     renewal or a correction).
 *   - Colab doesn't record which site engineer physically did the
 *     walkthrough — only who is currently pending to approve ("Abhishek
 *     (HSE_TEAM, L1)"). For the historical import we treat Abhishek R
 *     Mane as the maker (he runs inductions on site) and Girish R as
 *     the approver for Approved/Rejected rows, matching the going-
 *     forward Siddhi workflow Shraddha signed off on.
 *   - Status mapping:
 *       Open / Partial Approved → PENDING
 *       Approved → APPROVED, approvedById=GirishR, approvedAt=form_submission_date
 *       Rejected → REJECTED, rejectedById=GirishR, rejectedAt=form_submission_date,
 *                  rejectionReason="Imported from Colab · reason not captured"
 *   - Contractors referenced by inductions that don't exist in Siddhi
 *     (e.g. "Sanjay Das", "Nilakar") are created on the fly with
 *     category="Labour Supply" so the FK resolves.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeInductionExpiry } from "../src/lib/safetyInduction";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_INDUCTION_IMPORT !== "1") {
  console.error(
    "Refusing to run: DATABASE_URL points at a Neon host.\n" +
    "Set ALLOW_INDUCTION_IMPORT=1 to run against a Neon branch on purpose.",
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

/**
 * Same quoted-comma-aware CSV parser as import-work-permits.ts.
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

/**
 * Colab contractor names arrive vendor-prefixed ("Elegant-Elegant
 * Constructions", "NA-Abraham Thomas"). Strip the "<prefix>-" portion
 * when present, trim casing noise ("sanjay das" → "Sanjay Das"), and
 * collapse whitespace.
 */
function normalizeContractorName(raw: string): string {
  const stripped = raw.includes("-") ? raw.split("-").slice(1).join("-") : raw;
  const collapsed = stripped.trim().replace(/\s+/g, " ");
  return collapsed
    .split(" ")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * "2026-10-01 10:25:48" (Colab's ISO-ish shape, server time == IST per
 * their export) → Date in UTC. Pass through for safety when the input
 * is already ISO-parseable.
 */
function parseInductionDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) -
      (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  const iso = new Date(raw);
  return isNaN(iso.getTime()) ? null : iso;
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
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(normalizedName)) return cache.get(normalizedName) as string;
  const existing = await prisma.contractor.findFirst({
    where: { projectId, name: { equals: normalizedName, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    cache.set(normalizedName, existing.id);
    return existing.id;
  }
  const created = await prisma.contractor.create({
    data: {
      projectId,
      name: normalizedName,
      // "Labour Supply" is Siddhi's bucket for raw-manpower vendors who
      // don't carry civil / MEP / finishes scope. Matches how the site
      // team describes Sanjay Das / Nilakar / Achyutananda in Colab.
      category: "Labour Supply",
      active: true,
    },
    select: { id: true },
  });
  console.log(`  + created contractor on the fly: "${normalizedName}" (${created.id})`);
  cache.set(normalizedName, created.id);
  return created.id;
}

type RawStatus = "Open" | "Approved" | "Rejected" | "Partial Approved" | string;

function mapStatus(raw: RawStatus): "PENDING" | "APPROVED" | "REJECTED" {
  const s = raw.trim().toLowerCase();
  if (s === "approved") return "APPROVED";
  if (s === "rejected") return "REJECTED";
  // "Open" and "Partial Approved" both collapse to PENDING in Siddhi.
  return "PENDING";
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

  // Resolve the two canonical users up front so the loop doesn't thrash
  // the DB on every row. These are the maker + approver assumptions
  // documented at the top of this file.
  const userCache = new Map<string, string | null>();
  const makerId = await findUserByName("Abhishek R Mane", userCache);
  const approverId = await findUserByName("Girish R", userCache);
  if (!makerId) {
    console.error("Fatal: couldn't resolve Abhishek R Mane in users table.");
    process.exit(1);
  }
  if (!approverId) {
    console.error("Fatal: couldn't resolve Girish R in users table.");
    process.exit(1);
  }
  console.log(`Maker (createdById): ${makerId}`);
  console.log(`Approver (approvedById for Approved rows / rejectedById for Rejected): ${approverId}`);

  if (wipeFirst) {
    console.log("WIPE_FIRST=1 — wiping existing SafetyInduction rows for this project...");
    const wiped = await prisma.safetyInduction.deleteMany({
      where: { projectId: project.id },
    });
    console.log(`  deleted ${wiped.count} existing rows`);
  }

  const contractorCache = new Map<string, string>();
  const stats = {
    created: 0,
    skipped_existing: 0,
    skipped_bad_date: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    contractorsCreated: 0,
  };
  const unresolvedContractors = new Set<string>();

  for (const row of rows) {
    const csvId = row.safety_induction_id;
    if (!csvId) continue;
    const idempotencyKey = `colab-induction:${csvId}`;

    const existing = await prisma.safetyInduction.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_existing++;
      continue;
    }

    const inductionDate = parseInductionDate(row.form_submission_date);
    if (!inductionDate) {
      console.warn(`Row ${csvId}: couldn't parse form_submission_date "${row.form_submission_date}" — skipped`);
      stats.skipped_bad_date++;
      continue;
    }

    const normalizedContractor = normalizeContractorName(row.contractor_name);
    const beforeCount = contractorCache.size;
    const contractorId = await resolveOrCreateContractor(
      normalizedContractor,
      project.id,
      contractorCache,
    );
    if (contractorCache.size > beforeCount) {
      // We create the contractor during the first row that references it;
      // the actual +1 in stats.contractorsCreated happens inside the
      // helper's "+ created contractor on the fly" log. We approximate
      // here by counting the cache growth.
      stats.contractorsCreated++;
      unresolvedContractors.add(normalizedContractor);
    }

    const status = mapStatus(row.status);
    const approvedAt = status === "APPROVED" ? inductionDate : null;
    const rejectedAt = status === "REJECTED" ? inductionDate : null;
    const approvedById = status === "APPROVED" ? approverId : null;
    const rejectedById = status === "REJECTED" ? approverId : null;
    const rejectionReason = status === "REJECTED"
      ? "Imported from Colab · reason not captured in source export"
      : null;

    await prisma.safetyInduction.create({
      data: {
        projectId: project.id,
        displayId: csvId, // reuse Colab's EP-XXXXX directly so cross-system references stay stable
        workerName: row.labour_name || "Unknown",
        trade: row.trade || "Unspecified",
        gender: "Unspecified", // Colab export doesn't include gender
        contractorId,
        inductionDate,
        expiryDate: computeInductionExpiry(inductionDate),
        status,
        createdById: makerId,
        approvedById,
        approvedAt,
        rejectedById,
        rejectedAt,
        rejectionReason,
        createdAt: inductionDate,
        idempotencyKey,
      },
    });
    stats.created++;
    if (status === "PENDING") stats.pending++;
    if (status === "APPROVED") stats.approved++;
    if (status === "REJECTED") stats.rejected++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created:                   ${stats.created}`);
  console.log(`  → PENDING                ${stats.pending}`);
  console.log(`  → APPROVED               ${stats.approved}`);
  console.log(`  → REJECTED               ${stats.rejected}`);
  console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
  console.log(`Skipped (bad date):        ${stats.skipped_bad_date}`);
  console.log(`Contractors created:       ${stats.contractorsCreated}`);
  if (unresolvedContractors.size > 0) {
    console.log(`  ${Array.from(unresolvedContractors).join(", ")}`);
  }
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
