// One-time importer for the CollabTools daily-manpower CSV export.
//
// Colab writes one row per (contractor, trade, date) with planned + actual
// headcount. This importer:
//   1. Creates / reuses a Contractor row per Contractor_Name (stripping the
//      "NA-" prefix Colab prepends).
//   2. Groups consecutive same-plan dates per (contractor, trade) into
//      TradePlan rows with tight startDate / endDate — so the past reports
//      reflect the actual plan that was in effect on each day.
//   3. Upserts one ManpowerEntry per (contractor, trade, date) that carries
//      a non-empty Actual_Labour value. Idempotent via the composite unique.
//
// The importer is idempotent — safe to re-run on every fresh Colab manpower
// export. Existing TradePlans get their endDate re-tightened; existing
// ManpowerEntry actualCounts get updated in place.

import Papa from "papaparse";
import { TRADES } from "@/lib/manpower";

// Extended Prisma client with the pg adapter — same pragma as colabSync.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManpowerRow {
  Contractor_Id?: string;
  Contractor_Name?: string;
  Tags?: string;
  Date?: string;
  Trade_Name?: string;
  Planned_Labour?: string;
  Actual_Labour?: string;
  Updated_At?: string;
  Labour_ID?: string;
  Project_Name?: string;
}

export interface ColabManpowerStats {
  totalRows: number;
  skippedRows: number;                  // rows explicitly ignored (Charge Infra, etc.)
  skippedContractors: string[];
  contractorsCreated: string[];
  tradePlansCreated: number;
  tradePlansUpdated: number;
  manpowerEntriesCreated: number;
  manpowerEntriesUpdated: number;
  unmappedTrades: string[];             // trades in CSV not in Siddhi's TRADES
  elapsedMs: number;
}

export interface ColabManpowerOptions {
  dryRun: boolean;
  createdById: string;
  projectName?: string;                 // filter rows by Project_Name (e.g. "AMANVANA")
  ignoreContractors?: string[];         // e.g. ["Charge Infra"] — case-insensitive
  tradeAliases?: Record<string, string>; // e.g. { "Bar Bender Helper": "Helper" }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Colab dates are DD/MM/YYYY. Returns UTC-midnight or null on invalid. */
function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = +m[1];
  const mon = +m[2] - 1;
  const year = +m[3];
  return new Date(Date.UTC(year, mon, day));
}

function cleanContractorName(raw: string | undefined | null): string {
  return (raw ?? "").replace(/^NA-/, "").trim();
}

function toInt(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : Math.round(n);
}

/**
 * Group a chronologically sorted list of {date, plan} rows into runs where
 * the plan value stays the same. Returns [{plan, startDate, endDate}] with
 * endDate = day AFTER the last day in the run (matching TradePlan's half-
 * open convention).
 */
function collapseRuns(
  entries: Array<{ date: Date; plan: number }>,
): Array<{ plan: number; startDate: Date; endDate: Date }> {
  if (entries.length === 0) return [];
  const runs: Array<{ plan: number; startDate: Date; endDate: Date }> = [];
  let cur = { plan: entries[0].plan, startDate: entries[0].date, endDate: new Date(entries[0].date.getTime() + 86400000) };
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.plan === cur.plan) {
      // Extend the run's endDate to one day past this row.
      cur.endDate = new Date(e.date.getTime() + 86400000);
    } else {
      runs.push(cur);
      cur = { plan: e.plan, startDate: e.date, endDate: new Date(e.date.getTime() + 86400000) };
    }
  }
  runs.push(cur);
  return runs;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function importColabManpower(
  prisma: PrismaLike,
  projectId: string,
  csvText: string,
  options: ColabManpowerOptions,
): Promise<ColabManpowerStats> {
  const t0 = Date.now();
  const stats: ColabManpowerStats = {
    totalRows: 0,
    skippedRows: 0,
    skippedContractors: [],
    contractorsCreated: [],
    tradePlansCreated: 0,
    tradePlansUpdated: 0,
    manpowerEntriesCreated: 0,
    manpowerEntriesUpdated: 0,
    unmappedTrades: [],
    elapsedMs: 0,
  };

  const parsed = Papa.parse<ManpowerRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = parsed.data.filter((r) => r.Contractor_Name);
  stats.totalRows = rows.length;

  const ignoreSet = new Set(
    (options.ignoreContractors ?? []).map((n) => n.toLowerCase()),
  );
  const aliases = options.tradeAliases ?? {};
  const validTrades = new Set<string>(TRADES as readonly string[]);

  // Pre-load contractors so we can create-on-demand + cache by name.
  const contractorsInDb = await prisma.contractor.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
  const contractorByName = new Map<string, { id: string; name: string }>(
    (contractorsInDb as Array<{ id: string; name: string }>).map((c) => [c.name.toLowerCase(), c]),
  );

  // Bucket rows by (contractorName, trade) → list of {date, plan, actual}.
  interface Cell { date: Date; plan: number | null; actual: number | null }
  const buckets = new Map<string, Cell[]>();
  for (const r of rows) {
    if (options.projectName && r.Project_Name?.trim() !== options.projectName) {
      stats.skippedRows++;
      continue;
    }
    const cleaned = cleanContractorName(r.Contractor_Name);
    if (!cleaned) { stats.skippedRows++; continue; }
    if (ignoreSet.has(cleaned.toLowerCase())) {
      if (!stats.skippedContractors.includes(cleaned)) stats.skippedContractors.push(cleaned);
      stats.skippedRows++;
      continue;
    }
    const dateVal = parseDate(r.Date);
    if (!dateVal) { stats.skippedRows++; continue; }
    const rawTrade = (r.Trade_Name ?? "").trim();
    const trade = aliases[rawTrade] ?? rawTrade;
    if (!trade) { stats.skippedRows++; continue; }
    if (!validTrades.has(trade)) {
      if (!stats.unmappedTrades.includes(rawTrade)) stats.unmappedTrades.push(rawTrade);
    }
    const key = `${cleaned}::${trade}`;
    const cell: Cell = {
      date: dateVal,
      plan: toInt(r.Planned_Labour),
      actual: toInt(r.Actual_Labour),
    };
    const arr = buckets.get(key) ?? [];
    arr.push(cell);
    buckets.set(key, arr);
  }

  // Ensure a Contractor row exists for every contractor referenced (creates
  // Elegant / Abraham if the seed hasn't run yet).
  const ensureContractor = async (name: string): Promise<{ id: string; name: string } | null> => {
    const hit = contractorByName.get(name.toLowerCase());
    if (hit) return hit;
    if (options.dryRun) {
      if (!stats.contractorsCreated.includes(name)) stats.contractorsCreated.push(name);
      return null;
    }
    const created = await prisma.contractor.create({
      data: { projectId, name, category: "Civil", active: true },
      select: { id: true, name: true },
    });
    contractorByName.set(name.toLowerCase(), created);
    stats.contractorsCreated.push(name);
    return created;
  };

  // ---------- Process each (contractor, trade) bucket ----------
  for (const [key, cells] of buckets.entries()) {
    const [contractorName, trade] = key.split("::");
    cells.sort((a, b) => a.date.getTime() - b.date.getTime());

    const contractor = await ensureContractor(contractorName);
    if (!contractor) continue; // dry-run + not yet created

    // -------- TradePlan runs --------
    const withPlan = cells
      .filter((c): c is Cell & { plan: number } => c.plan != null)
      .map((c) => ({ date: c.date, plan: c.plan! }));
    const runs = collapseRuns(withPlan);

    if (!options.dryRun) {
      // Wipe our previously-imported runs for this (contractor, trade), then
      // re-insert. Idempotency by rewrite: cheaper than diff-and-patch, and
      // safe because Colab is authoritative for historical plan.
      await prisma.tradePlan.deleteMany({
        where: {
          projectId,
          contractorId: contractor.id,
          trade,
          // Only delete the ones sourced from Colab — anything set later in
          // Siddhi with a notes tag stays untouched. Absence of the notes
          // sentinel means the row was NOT set by Siddhi's admin console.
          notes: { equals: "imported-from-colab" },
        },
      });
      for (const run of runs) {
        await prisma.tradePlan.create({
          data: {
            projectId,
            contractorId: contractor.id,
            trade,
            plannedCount: run.plan,
            startDate: run.startDate,
            endDate: run.endDate,
            notes: "imported-from-colab",
            createdById: options.createdById,
          },
        });
        stats.tradePlansCreated++;
      }
    } else {
      stats.tradePlansCreated += runs.length;
    }

    // -------- ManpowerEntry per day with actual --------
    for (const cell of cells) {
      if (cell.actual == null) continue;
      if (options.dryRun) {
        stats.manpowerEntriesCreated++;
        continue;
      }
      const existing = await prisma.manpowerEntry.findUnique({
        where: {
          projectId_contractorId_trade_entryDate: {
            projectId,
            contractorId: contractor.id,
            trade,
            entryDate: cell.date,
          },
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.manpowerEntry.update({
          where: { id: existing.id },
          data: { actualCount: cell.actual },
        });
        stats.manpowerEntriesUpdated++;
      } else {
        await prisma.manpowerEntry.create({
          data: {
            projectId,
            contractorId: contractor.id,
            trade,
            entryDate: cell.date,
            actualCount: cell.actual,
            createdById: options.createdById,
          },
        });
        stats.manpowerEntriesCreated++;
      }
    }
  }

  stats.elapsedMs = Date.now() - t0;
  return stats;
}
