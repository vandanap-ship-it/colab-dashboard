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
 *
 * DRY RUN BY DEFAULT: prints what would be created and writes nothing.
 * Add APPLY=1 to write. Merge-safe: rows already imported (by Labour_ID)
 * are skipped, and Siddhi wins any day the site team logged there — Colab
 * rows (headcounts and plans) for that contractor + day are skipped, never
 * overwritten. Prints a date-by-date cross-check of Colab vs Siddhi.
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
const apply = process.env.APPLY === "1";
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

// TradePlans this importer creates carry this note, so a re-run can tell
// its own plans apart from ones the site team set in Siddhi.
const COLAB_PLAN_NOTE = "colab-import";
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

async function importManpower(projectId: string, adminId: string): Promise<void> {
  if (!manpowerCsv) { console.log("(no MANPOWER_CSV — skipping)"); return; }
  const rows = parseCsv(readFileSync(manpowerCsv, "utf8"));
  console.log(`\n=== Manpower: ${rows.length} rows ===`);
  const contractorCache = new Map<string, string | null>();
  const contractorLabel = new Map<string, string>();
  const stats = { created: 0, skipped: 0, siddhiDay: 0, noContractor: 0, noData: 0 };
  // TradePlan rows come from the Planned_Labour column on the same CSV row.
  // Colab's export carries the plan on every day (one row per contractor+
  // trade+date), so we mirror that shape — one single-day TradePlan per row.
  // Scorecard §03's "26 present / 25 planned" ratio needs this to render.
  const planStats = { created: 0, skipped: 0, siddhiDay: 0, noData: 0 };
  const seenPlanKeys = new Set<string>();

  // Siddhi is the source of truth for any day the site team logged there
  // (Shraddha, 2026-10-07): Colab only fills days Siddhi doesn't have. The
  // rule is per contractor per DAY, not per trade, so a trade spelled
  // differently in Siddhi can't let a Colab row double up that day.
  // Snapshot what the team entered BEFORE writing, so rows this run creates
  // never count as "Siddhi's". Deleted entries still count: they hold the
  // unique (contractor, trade, day) slot and mark a day the team touched.
  const [nativeEntries, nativePlans] = await Promise.all([
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: "colab-manpower:" } } }],
      },
      select: { contractorId: true, trade: true, entryDate: true, actualCount: true, deletedAt: true, contractor: { select: { name: true } } },
    }),
    prisma.tradePlan.findMany({
      where: {
        projectId, deletedAt: null,
        OR: [{ notes: null }, { notes: { not: COLAB_PLAN_NOTE } }],
      },
      select: { contractorId: true, startDate: true, endDate: true },
    }),
  ]);
  const siddhiDays = new Map<string, Array<{ trade: string; actualCount: number; deleted: boolean }>>();
  for (const e of nativeEntries) {
    contractorLabel.set(e.contractorId, e.contractor.name);
    const k = `${e.contractorId}|${dayKey(e.entryDate)}`;
    const list = siddhiDays.get(k) ?? [];
    list.push({ trade: e.trade, actualCount: e.actualCount, deleted: !!e.deletedAt });
    siddhiDays.set(k, list);
  }
  const siddhiPlanCovers = (contractorId: string, day: Date) =>
    nativePlans.some((p) =>
      p.contractorId === contractorId &&
      p.startDate.getTime() <= day.getTime() &&
      (p.endDate == null || p.endDate.getTime() > day.getTime()));

  // Per-day Colab totals for the date cross-check printed at the end.
  const colabDays = new Map<string, { contractor: string; workers: number; trades: string[]; action: string }>();

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
      const matches = await prisma.contractor.findMany({
        where: { projectId, name: { contains: contractorNameRaw, mode: "insensitive" } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      contractorId = matches[0]?.id ?? null;
      contractorCache.set(contractorNameRaw, contractorId);
      const shown = matches.map((m) => `"${m.name}"`).join(", ") || "NO MATCH — rows skipped";
      console.log(`  Contractor "${contractorNameRaw}" → ${shown}${matches.length > 1 ? "  ⚠ several match — first one used" : ""}`);
    }
    if (!contractorId) { stats.noContractor++; continue; }
    const entryDate = parseSlashDate(dateRaw);
    if (!entryDate) { stats.noData++; continue; }
    const dayIsSiddhis = siddhiDays.has(`${contractorId}|${dayKey(entryDate)}`);

    // Seed the planned side FIRST (before the ManpowerEntry dedup) so
    // that re-running the importer fills in TradePlan rows even for days
    // whose ManpowerEntry already exists.
    const plannedStr = row.Planned_Labour?.trim();
    const plannedCount = plannedStr ? Math.round(Number(plannedStr)) : NaN;
    if (Number.isFinite(plannedCount) && plannedCount > 0) {
      const planKey = `${contractorId}|${trade}|${dayKey(entryDate)}`;
      if (!seenPlanKeys.has(planKey)) {
        seenPlanKeys.add(planKey);
        const nextDay = new Date(entryDate.getTime() + 86_400_000);
        const existingPlan = await prisma.tradePlan.findFirst({
          where: { projectId, contractorId, trade, startDate: entryDate, endDate: nextDay, deletedAt: null, notes: COLAB_PLAN_NOTE },
          select: { id: true, plannedCount: true },
        });
        if (existingPlan) {
          if (existingPlan.plannedCount !== plannedCount && apply) {
            await prisma.tradePlan.update({ where: { id: existingPlan.id }, data: { plannedCount } });
          }
          planStats.skipped++;
        } else if (dayIsSiddhis || siddhiPlanCovers(contractorId, entryDate)) {
          // Overlapping plans aren't summed — the latest startDate wins
          // (src/lib/manpower.ts) — so a Colab single-day plan would
          // silently override the team's plan for that day. Keep theirs.
          planStats.siddhiDay++;
        } else {
          if (apply) await prisma.tradePlan.create({
            data: {
              projectId, contractorId, trade,
              plannedCount,
              startDate: entryDate,
              endDate: nextDay,
              notes: COLAB_PLAN_NOTE,
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

    const day = colabDays.get(`${contractorId}|${dayKey(entryDate)}`) ??
      { contractor: contractorNameRaw, workers: 0, trades: [], action: "" };
    day.workers += actualCount;
    day.trades.push(`${trade} ${actualCount}`);
    colabDays.set(`${contractorId}|${dayKey(entryDate)}`, day);

    const idempotencyKey = `colab-manpower:${labourId}`;
    const existing = await prisma.manpowerEntry.findUnique({
      where: { idempotencyKey }, select: { id: true },
    });
    if (existing) { stats.skipped++; day.action = "already imported"; continue; }

    if (dayIsSiddhis) { stats.siddhiDay++; day.action = "KEPT SIDDHI'S"; continue; }

    day.action = apply ? "added from Colab" : "would add from Colab";
    if (!apply) { stats.created++; continue; }

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

  // Date cross-check: every day Colab has headcounts for, against what the
  // site team entered in Siddhi for the same contractor and day.
  console.log("\n--- Date cross-check (Colab days with workers) ---");
  for (const [k, d] of [...colabDays].sort(([a], [b]) => (a.split("|")[1] < b.split("|")[1] ? -1 : 1))) {
    const [cid, day] = k.split("|");
    const siddhi = siddhiDays.get(k);
    const siddhiTxt = siddhi
      ? siddhi.map((e) => `${e.trade} ${e.actualCount}${e.deleted ? " (deleted)" : ""}`).join(", ")
      : "—";
    console.log(`  ${day}  ${(contractorLabel.get(cid) ?? d.contractor).padEnd(15)} Colab ${String(d.workers).padStart(3)}  Siddhi: ${siddhiTxt.padEnd(40)} → ${d.action}`);
  }
  const otherSiddhiDays = [...siddhiDays.keys()].filter((k) => !colabDays.has(k)).sort();
  console.log(`\nDays the team logged in Siddhi that Colab doesn't have (untouched): ${otherSiddhiDays.length}`);
  for (const k of otherSiddhiDays) {
    const [cid, day] = k.split("|");
    const total = siddhiDays.get(k)!.reduce((n, e) => n + e.actualCount, 0);
    console.log(`  ${day}  ${contractorLabel.get(cid) ?? cid}  Siddhi ${total}`);
  }

  console.log(`\n${apply ? "Created" : "Would create"} ${stats.created} · Skipped (already imported) ${stats.skipped} · Kept Siddhi's day ${stats.siddhiDay} · No contractor ${stats.noContractor} · No data ${stats.noData}`);
  console.log(`${apply ? "" : "(dry run) "}TradePlan · ${apply ? "Created" : "Would create"} ${planStats.created} · Skipped (already imported) ${planStats.skipped} · Kept Siddhi's plan/day ${planStats.siddhiDay} · No data ${planStats.noData}`);
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

    if (!apply) { stats.created++; continue; }
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

  console.log(apply ? "Mode: APPLY — writing to the database" : "Mode: DRY RUN — nothing will be written (add APPLY=1 to write)");
  await importManpower(project.id, admin.id);
  await importHindrances(project.id, admin.id);

  const mp = await prisma.manpowerEntry.count({ where: { projectId: project.id, deletedAt: null } });
  const hi = await prisma.hindrance.count({ where: { projectId: project.id, deletedAt: null } });
  console.log(`\n=== Totals ${apply ? "after import" : "currently in DB (dry run)"} ===\n  Manpower entries: ${mp}\n  Hindrances:       ${hi}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
