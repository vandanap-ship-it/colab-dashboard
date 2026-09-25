/**
 * One-off importer for Colab's Manpower + Hindrances CSVs into Siddhi's
 * ManpowerEntry + Hindrance tables. Populates the Manpower module,
 * Dashboard's active-hindrances card, and EHS's Safe Man-Hours count
 * (which is `Σ ManpowerEntry.actualCount * 8`).
 *
 *   PROJECT_NAME="Amanvana" \
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
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
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
  // UTC midnight for the IST calendar day the CSV row belongs to. Matches
  // the shape src/lib/istDay.ts's istDayStart returns, which is what every
  // report ("dayStart" in scorecardServer, weeklyReportServer etc.) uses
  // to filter ManpowerEntry / TradePlan. Storing at 06:30 UTC — the old
  // "noon IST" convention — broke the exact-match `entryDate: dayStart`
  // query the scorecard uses for §03 manpower.
  return new Date(Date.UTC(yr, +mo - 1, +d, 0, 0, 0));
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
  // TradePlan rows come from the Planned_Labour column on the same CSV row.
  // Colab's export carries the plan on every day (one row per contractor+
  // trade+date), so we mirror that shape — one single-day TradePlan per row.
  // Scorecard §03's "26 present / 25 planned" ratio needs this to render.
  const planStats = { created: 0, skipped: 0, noData: 0 };
  const seenPlanKeys = new Set<string>();

  for (const row of rows) {
    const labourId = row.Labour_ID?.trim();
    const dateRaw = row.Date?.trim();
    const trade = row.Trade_Name?.trim();
    if (!labourId || !dateRaw || !trade) { stats.noData++; continue; }

    // Resolve contractor + date up-front — both are needed for TradePlan
    // (which we seed regardless of whether the ManpowerEntry row is new)
    // and for the ManpowerEntry itself. If either can't be resolved, skip.
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

    // Seed the planned side FIRST (before the ManpowerEntry dedup) so
    // that re-running the importer fills in TradePlan rows even for days
    // whose ManpowerEntry already exists.
    const plannedStr = row.Planned_Labour?.trim();
    const plannedCount = plannedStr ? Math.round(Number(plannedStr)) : NaN;
    if (Number.isFinite(plannedCount) && plannedCount > 0) {
      const planKey = `${contractorId}|${trade}|${entryDate.toISOString().slice(0, 10)}`;
      if (!seenPlanKeys.has(planKey)) {
        seenPlanKeys.add(planKey);
        const nextDay = new Date(entryDate.getTime() + 86_400_000);
        const existingPlan = await prisma.tradePlan.findFirst({
          where: { projectId, contractorId, trade, startDate: entryDate, endDate: nextDay, deletedAt: null },
          select: { id: true, plannedCount: true },
        });
        if (existingPlan) {
          if (existingPlan.plannedCount !== plannedCount) {
            await prisma.tradePlan.update({ where: { id: existingPlan.id }, data: { plannedCount } });
          }
          planStats.skipped++;
        } else {
          await prisma.tradePlan.create({
            data: {
              projectId, contractorId, trade,
              plannedCount,
              startDate: entryDate,
              endDate: nextDay,
              createdById: adminId,
              createdAt: entryDate,
            },
          });
          planStats.created++;
        }
      }
    } else {
      planStats.noData++;
    }

    // Now the ManpowerEntry (actual) — this side is idempotent by
    // Labour_ID and skips already-imported rows.
    const actualStr = row.Actual_Labour?.trim();
    if (!actualStr) { stats.noData++; continue; }
    const actualCount = Math.round(Number(actualStr));
    if (!Number.isFinite(actualCount) || actualCount <= 0) { stats.noData++; continue; }

    const idempotencyKey = `colab-manpower:${labourId}`;
    const existing = await prisma.manpowerEntry.findUnique({
      where: { idempotencyKey }, select: { id: true },
    });
    if (existing) { stats.skipped++; continue; }

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
  console.log(`TradePlan · Created ${planStats.created} · Skipped ${planStats.skipped} · No data ${planStats.noData}`);
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
