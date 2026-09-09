/**
 * One-off importer for Colab's Manpower + Hindrances CSVs into Siddhi's
 * ManpowerEntry + Hindrance tables. Populates the Manpower module,
 * Dashboard's active-hindrances card, and EHS's Safe Man-Hours count
 * (which is `Σ ManpowerEntry.actualCount * 8`).
 *
 *   PROJECT_NAME="Amanvana - Phase 1" \
 *   MANPOWER_CSV=colab-manpower.csv \
 *   HINDRANCES_CSV=colab-hindrances.csv \
 *   ALLOW_COLAB_MPWR_IMPORT=1 \
 *   npx tsx scripts/import-colab-manpower-hindrances.ts
 *
 * Same guarded-Neon-URL pattern as the other Colab importers.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_COLAB_MPWR_IMPORT !== "1") {
  console.error("Refusing: set ALLOW_COLAB_MPWR_IMPORT=1 to run against Neon.");
  process.exit(1);
}

const manpowerCsv = process.env.MANPOWER_CSV;
const hindrancesCsv = process.env.HINDRANCES_CSV;
const projectName = process.env.PROJECT_NAME ?? "Amanvana - Phase 1";
if (!manpowerCsv && !hindrancesCsv) {
  console.error("At least one of MANPOWER_CSV or HINDRANCES_CSV required");
  process.exit(1);
}
for (const p of [manpowerCsv, hindrancesCsv]) {
  if (p && !existsSync(p)) { console.error(`Missing: ${p}`); process.exit(1); }
}

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

/** dd/mm/yyyy → Date at IST noon */
function parseSlashDate(raw: string): Date | null {
  const m = raw?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
  return new Date(Date.UTC(yr, +mo - 1, +d, 12, 0, 0) - (5 * 60 + 30) * 60_000);
}

/** dd-mm-yyyy HH:MM:SS → Date (Colab hindrance format, IST-local) */
function parseHyphenDate(raw: string): Date | null {
  const m = raw?.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, hh, mi, ss] = m;
  const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
  const utcMs = Date.UTC(yr, +mo - 1, +d, +(hh ?? 12), +(mi ?? 0), +(ss ?? 0)) - (5 * 60 + 30) * 60_000;
  return new Date(utcMs);
}

/** Colab Hindrance_Type → Siddhi reason code */
function mapReasonCode(type: string): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("manpower") || t.includes("labour") || t.includes("labor")) return "LABOUR";
  if (t.includes("material")) return "MATERIAL";
  if (t.includes("design")) return "DESIGN";
  if (t.includes("drawing")) return "MEP_DRAWING";
  if (t.includes("rmc")) return "RMC";
  if (t.includes("weather") || t.includes("rain")) return "WEATHER";
  if (t.includes("vendor")) return "VENDOR_CHANGE";
  if (t.includes("approval")) return "APPROVAL";
  if (t.includes("coordination")) return "COORDINATION";
  if (t.includes("change")) return "CHANGE_ORDER";
  return "OTHER";
}

async function importManpower(projectId: string, adminId: string): Promise<void> {
  if (!manpowerCsv) { console.log("(no MANPOWER_CSV — skipping)"); return; }
  const rows = parseCsv(readFileSync(manpowerCsv, "utf8"));
  console.log(`\n=== Manpower: ${rows.length} rows ===`);
  const contractorCache = new Map<string, string | null>();
  const stats = { created: 0, skipped: 0, noContractor: 0, noData: 0 };

  for (const row of rows) {
    const labourId = row.Labour_ID?.trim();
    const dateRaw = row.Date?.trim();
    const trade = row.Trade_Name?.trim();
    const actualStr = row.Actual_Labour?.trim();
    if (!labourId || !dateRaw || !trade || !actualStr) { stats.noData++; continue; }

    const actualCount = Math.round(Number(actualStr));
    if (!Number.isFinite(actualCount) || actualCount <= 0) { stats.noData++; continue; }

    const idempotencyKey = `colab-manpower:${labourId}`;
    const existing = await prisma.manpowerEntry.findUnique({
      where: { idempotencyKey }, select: { id: true },
    });
    if (existing) { stats.skipped++; continue; }

    const contractorNameRaw = row.Contractor_Name?.replace(/^NA-/i, "").trim();
    if (!contractorNameRaw) { stats.noContractor++; continue; }
    let contractorId = contractorCache.get(contractorNameRaw);
    if (contractorId === undefined) {
      const c = await prisma.contractor.findFirst({
        where: { projectId, name: { contains: contractorNameRaw, mode: "insensitive" } },
        select: { id: true },
      });
      contractorId = c?.id ?? null;
      contractorCache.set(contractorNameRaw, contractorId);
    }
    if (!contractorId) { stats.noContractor++; continue; }

    const entryDate = parseSlashDate(dateRaw);
    if (!entryDate) { stats.noData++; continue; }

    await prisma.manpowerEntry.create({
      data: {
        projectId,
        contractorId,
        trade,
        entryDate,
        actualCount,
        createdById: adminId,
        idempotencyKey,
        createdAt: entryDate,
      },
    });
    stats.created++;
  }

  console.log(`Created ${stats.created} · Skipped ${stats.skipped} · No contractor ${stats.noContractor} · No data ${stats.noData}`);
}

async function importHindrances(projectId: string, adminId: string): Promise<void> {
  if (!hindrancesCsv) { console.log("(no HINDRANCES_CSV — skipping)"); return; }
  const rows = parseCsv(readFileSync(hindrancesCsv, "utf8"));
  console.log(`\n=== Hindrances: ${rows.length} rows ===`);
  const stats = { created: 0, skipped: 0, noData: 0 };

  for (const row of rows) {
    const hindranceId = row.Hindrance_ID?.trim();
    if (!hindranceId) { stats.noData++; continue; }

    // Multiple CSV rows may share the same Hindrance_ID (Colab exports one
    // row per Location combination). Dedupe on the ID — one Hindrance per id.
    const idempotencyKey = `colab-hindrance:${hindranceId}`;
    const existing = await prisma.hindrance.findUnique({
      where: { idempotencyKey }, select: { id: true },
    });
    if (existing) { stats.skipped++; continue; }

    const startDate = parseHyphenDate(row.Hindrance_Start_Date);
    if (!startDate) { stats.noData++; continue; }
    const resolvedDate = parseHyphenDate(row.Hindrance_End_Date);
    const isResolved = !!resolvedDate;

    const description =
      row.Description?.trim() ||
      row.Hindrance_Reason?.trim() ||
      "(no description)";

    const daysImpact =
      resolvedDate && startDate
        ? Math.max(1, Math.round((resolvedDate.getTime() - startDate.getTime()) / 86_400_000))
        : null;

    const reasonCode = mapReasonCode(row.Hindrance_Type ?? "");
    const reasonNote =
      row.Hindrance_Reason?.trim() && row.Hindrance_Reason !== row.Description
        ? row.Hindrance_Reason.trim()
        : null;

    await prisma.hindrance.create({
      data: {
        projectId,
        description,
        startDate,
        resolvedDate,
        daysImpact,
        status: isResolved ? "CLOSED" : "OPEN",
        reasonCode,
        reasonNote,
        createdById: adminId,
        idempotencyKey,
        createdAt: startDate,
      },
    });
    stats.created++;
  }
  console.log(`Created ${stats.created} · Skipped ${stats.skipped} · No data ${stats.noData}`);
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) { console.error(`Project not found: ${projectName}`); process.exit(1); }
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) { console.error("Admin user not found"); process.exit(1); }

  await importManpower(project.id, admin.id);
  await importHindrances(project.id, admin.id);

  const mp = await prisma.manpowerEntry.count({ where: { projectId: project.id, deletedAt: null } });
  const hi = await prisma.hindrance.count({ where: { projectId: project.id, deletedAt: null } });
  console.log(`\n=== Totals after import ===\n  Manpower entries: ${mp}\n  Hindrances:       ${hi}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
