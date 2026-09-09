/**
 * One-off importer for Colab's historical Checklists (→ Siddhi Inspection)
 * and Issues (→ Siddhi Issue). Populates the QA/QC and EHS tabs with the
 * team's existing history so Monday's walkthrough shows real data.
 *
 * Idempotent by Colab's row id: re-running skips already-imported rows.
 *
 *   PROJECT_NAME="Amanvana - Phase 1" \
 *   INSPECTIONS_CSV=./checklists.csv \
 *   ISSUES_CSV=./issues.csv \
 *   ALLOW_COLAB_QAQC_IMPORT=1 \
 *   npx tsx scripts/import-colab-qaqc.ts
 *
 * Refuses to run against Neon without ALLOW_COLAB_QAQC_IMPORT=1 — matches
 * the guards on scripts/import-work-permits.ts + seed.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_COLAB_QAQC_IMPORT !== "1") {
  console.error(
    "Refusing to run: DATABASE_URL points at a Neon host.\n" +
    "Set ALLOW_COLAB_QAQC_IMPORT=1 to run against a Neon branch on purpose.",
  );
  process.exit(1);
}

const inspectionsCsv = process.env.INSPECTIONS_CSV;
const issuesCsv = process.env.ISSUES_CSV;
const projectName = process.env.PROJECT_NAME ?? "Amanvana - Phase 1";
if (!inspectionsCsv && !issuesCsv) {
  console.error("At least one of INSPECTIONS_CSV or ISSUES_CSV is required");
  process.exit(1);
}
for (const p of [inspectionsCsv, issuesCsv]) {
  if (p && !existsSync(p)) {
    console.error(`CSV not found: ${p}`);
    process.exit(1);
  }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/**
 * Bare-bones CSV parser that handles quoted fields with commas inside them.
 * Copied verbatim from scripts/import-work-permits.ts — small enough that a
 * shared helper isn't worth the file dependency for a one-off import script.
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
 * Colab embeds users' role + org in parentheses after the name:
 *   "Thangamani G (Manager - QA/QC, White Lotus)"
 * Strip that for a plain "Thangamani G" that matches User.name.
 */
function stripParens(name: string): string {
  return name.replace(/\s*\(.*?\)\s*$/, "").trim();
}

async function findUserByName(name: string, cache: Map<string, string | null>): Promise<string | null> {
  const trimmed = stripParens(name);
  if (!trimmed) return null;
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null;
  // Match strategy mirrors scripts/import-work-permits.ts. First-word prefix
  // lookup then narrow: exact, then any-word contains, then first-word starts.
  const users = await prisma.user.findMany({
    where: { active: true, name: { contains: trimmed.split(" ")[0], mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const lower = trimmed.toLowerCase();
  const exact = users.find((u) => u.name.toLowerCase() === lower);
  const partial = users.find((u) => u.name.toLowerCase().includes(lower));
  const prefix = users.find((u) => u.name.toLowerCase().startsWith(lower));
  const picked = exact ?? partial ?? prefix ?? null;
  cache.set(trimmed, picked?.id ?? null);
  return picked?.id ?? null;
}

/**
 * Colab's contractor field carries a prefix like "NA-Abraham Thomas". Strip
 * the "NA-" and try to look up. If not found, return null so the row imports
 * without a contractor link rather than failing.
 */
async function findContractorByName(
  name: string,
  projectId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const clean = name.replace(/^NA-/i, "").trim();
  if (!clean) return null;
  if (cache.has(clean)) return cache.get(clean) ?? null;
  const c = await prisma.contractor.findFirst({
    where: { projectId, name: { contains: clean, mode: "insensitive" } },
    select: { id: true },
  });
  cache.set(clean, c?.id ?? null);
  return c?.id ?? null;
}

/**
 * Colab dates come in two flavours:
 *   "08-09-2026 19:36:51"  (dd-mm-yyyy HH:MM:SS)
 *   "04 Jul 2026"          (dd Mon yyyy)
 * Convert to Date. Interpret both as IST — Colab stores IST-local time.
 */
function parseColabDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  // dd-mm-yyyy HH:MM:SS
  const m1 = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m1) {
    const [, dd, mm, yy, hh, mi, ss] = m1;
    const utcMs = Date.UTC(+yy, +mm - 1, +dd, +hh, +mi, +ss) - (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  // dd Mon yyyy
  const m2 = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m2) {
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const [, dd, mon, yy] = m2;
    const monthIdx = months[mon];
    if (monthIdx == null) return null;
    const utcMs = Date.UTC(+yy, monthIdx, +dd, 12, 0, 0) - (5 * 60 + 30) * 60_000;
    return new Date(utcMs);
  }
  const iso = new Date(raw);
  return isNaN(iso.getTime()) ? null : iso;
}

// ---------------------------------------------------------------------------
// Inspection (Checklist) importer
// ---------------------------------------------------------------------------
async function importInspections(projectId: string): Promise<void> {
  if (!inspectionsCsv) {
    console.log("(no INSPECTIONS_CSV — skipping inspection import)");
    return;
  }
  const rows = parseCsv(readFileSync(inspectionsCsv, "utf8"));
  console.log(`\n=== Inspections: ${rows.length} rows ===`);
  const userCache = new Map<string, string | null>();
  const stats = { created: 0, skipped: 0, noUser: 0 };

  for (const row of rows) {
    const triggerId = row.trigger_id;
    const idempotencyKey = `colab-inspection:${triggerId}`;
    const existing = await prisma.inspection.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) { stats.skipped++; continue; }

    const filledById = await findUserByName(row.triggered_by, userCache);
    if (!filledById) {
      console.warn(`  Row ${triggerId}: no user matches triggered_by "${row.triggered_by}" — skipped`);
      stats.noUser++;
      continue;
    }

    const reviewedById = row.rank_1_approver ? await findUserByName(row.rank_1_approver, userCache) : null;

    // Status inference from timestamps (Colab's `status` column is stale for
    // completed items — the approval-level column is more informative).
    let status: "IN_REVIEW" | "PASSED" | "REJECTED" = "IN_REVIEW";
    let reviewedAt: Date | null = null;
    if (row.approved_date?.trim()) {
      status = "PASSED";
      reviewedAt = parseColabDate(row.approved_date);
    } else if (row.rejected_date?.trim()) {
      status = "REJECTED";
      reviewedAt = parseColabDate(row.rejected_date);
    }

    // Module tag drives which tab (QA/QC vs EHS) the row surfaces under.
    // Colab's `category` says "Quality" or "Safety" verbatim.
    const module = row.category === "Safety" ? "SAFETY" : row.category === "Quality" ? "QAQC" : null;

    const rejectionReason =
      status === "REJECTED"
        ? (row.reject_remark || row.remark || null)
        : null;

    await prisma.inspection.create({
      data: {
        projectId,
        title: row.checklist_name || "(untitled checklist)",
        status,
        rejectionReason,
        filledById,
        reviewedById,
        reviewedAt,
        module,
        idempotencyKey,
        createdAt: parseColabDate(row.triggered_timestamp) ?? new Date(),
      },
    });
    stats.created++;
  }
  console.log(`Created ${stats.created} · Skipped ${stats.skipped} (already) · No user ${stats.noUser}`);
}

// ---------------------------------------------------------------------------
// Issue (Snag) importer
// ---------------------------------------------------------------------------
async function importIssues(projectId: string): Promise<void> {
  if (!issuesCsv) {
    console.log("(no ISSUES_CSV — skipping issue import)");
    return;
  }
  const rows = parseCsv(readFileSync(issuesCsv, "utf8"));
  console.log(`\n=== Issues: ${rows.length} rows ===`);
  const userCache = new Map<string, string | null>();
  const stats = { created: 0, skipped: 0, noUser: 0 };

  for (const row of rows) {
    const issueId = row.Issue_id;
    const idempotencyKey = `colab-issue:${issueId}`;
    const existing = await prisma.issue.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) { stats.skipped++; continue; }

    const createdById = await findUserByName(row.Created_By, userCache);
    if (!createdById) {
      console.warn(`  Row ${issueId}: no user matches Created_By "${row.Created_By}" — skipped`);
      stats.noUser++;
      continue;
    }
    const assignedToId = row.Assigned_To ? await findUserByName(row.Assigned_To, userCache) : null;

    const statusMap: Record<string, string> = {
      "Close Without Debit": "RESOLVED",
      "Closed": "RESOLVED",
      "Close With Debit": "RESOLVED",
      "In Review": "OPEN",
      "Open": "OPEN",
      "Rejected": "OPEN",
    };
    const status = statusMap[row.Issue_Status] ?? "OPEN";

    const severityMap: Record<string, string> = {
      Minor: "LOW",
      Major: "MEDIUM",
      Critical: "HIGH",
    };
    const severity = row.Issue_Priority ? severityMap[row.Issue_Priority] ?? "MEDIUM" : null;

    // Module tag — Colab's `Issue_Category` is "Quality" or "Safety".
    const module =
      row.Issue_Category === "Safety" ? "SAFETY" :
      row.Issue_Category === "Quality" ? "QAQC" :
      null;

    // Prefer the more-specific description if available.
    const description =
      row.Issue_Tags?.trim() ||
      row.Viewpoint_Remark?.trim() ||
      row.Issue_Final_Remark?.trim() ||
      "(no description)";

    // Parent_Category is the sub-taxonomy inside Quality/Safety (e.g. Reinforcement).
    const category = row.Parent_Category?.trim() || row.Issue_Type?.trim() || null;

    await prisma.issue.create({
      data: {
        projectId,
        description,
        severity,
        category,
        status,
        createdById,
        assignedToId,
        module,
        idempotencyKey,
        createdAt: parseColabDate(row.Creation_Date) ?? new Date(),
      },
    });
    stats.created++;
  }
  console.log(`Created ${stats.created} · Skipped ${stats.skipped} (already) · No user ${stats.noUser}`);
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) {
    console.error(`Project not found by name: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Importing into project: ${project.name} (${project.id})`);

  await importInspections(project.id);
  await importIssues(project.id);

  const inspCount = await prisma.inspection.count({ where: { projectId: project.id } });
  const issueCount = await prisma.issue.count({ where: { projectId: project.id } });
  console.log(`\n=== Totals after import ===`);
  console.log(`  Inspections: ${inspCount}`);
  console.log(`  Issues:      ${issueCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
