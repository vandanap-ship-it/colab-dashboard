// Pure manpower rollup logic — no Prisma imports, all inputs plain shapes so
// this module is trivially unit-testable and the same code powers both the
// mobile capture flow and the desktop report layer.
//
// Design decisions locked with Shraddha:
//   - Planned headcount lives on TradePlan (admin-set, effective startDate →
//     endDate) — one row per contractor × trade × effective period.
//   - Actual headcount lives on ManpowerEntry — one row per contractor × trade
//     × day. Site engineer logs from mobile; the (project, contractor, trade,
//     entryDate) unique index makes re-submits update, not duplicate.
//   - The report "planned vs actual" comparison is day-granular. If two
//     TradePlans overlap on a day (shouldn't happen — but if it does), the
//     one with the latest startDate wins (most-recent-plan-of-record).

// ---------------------------------------------------------------------------
// Canonical trade list
// ---------------------------------------------------------------------------

/**
 * Trades Shraddha uses today at Amanvana. Extensible — admin adds a new
 * TradePlan with a new `trade` string and it just appears in reports.
 * Ordering here also drives the report display order.
 */
export const TRADES = [
  "Bar Bender",
  "Carpenter",
  "Helper",
  "Mason",
] as const;

export type TradeName = (typeof TRADES)[number];

/** Return a stable sort index for a trade, unknown trades sort last. */
export function tradeOrder(t: string): number {
  const i = (TRADES as readonly string[]).indexOf(t);
  return i === -1 ? TRADES.length : i;
}

// ---------------------------------------------------------------------------
// Plain shapes — mirror the Prisma models but decoupled so tests don't need a
// live client. Callers project their DB rows into these before invoking the
// rollup functions.
// ---------------------------------------------------------------------------

export interface TradePlanRow {
  contractorId: string;
  trade: string;
  plannedCount: number;
  startDate: Date;
  endDate: Date | null; // null = still current
}

export interface ManpowerEntryRow {
  contractorId: string;
  trade: string;
  entryDate: Date; // day-precision
  actualCount: number;
}

export interface TradeCell {
  contractorId: string;
  /** Optional; populated by callers with DB access so the report can render
   *  "Mason · Abraham Thomas" instead of two indistinguishable "Mason" rows. */
  contractorName?: string;
  trade: string;
  planned: number;
  actual: number;
  /** actual − planned (positive means over plan). */
  variance: number;
  /** Rounded % of plan; null when planned is 0 (avoid divide-by-zero). */
  pctOfPlan: number | null;
}

export interface DaySummary {
  date: Date;
  plannedTotal: number;
  actualTotal: number;
  variance: number;
  pctOfPlan: number | null;
  /** Per-contractor-per-trade breakdown, sorted by (contractor, trade order). */
  trades: TradeCell[];
  /** True if any entries were logged this day (even if 0 counts). */
  hasEntries: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers — day-boundary math is a landmine so isolate it here.
// ---------------------------------------------------------------------------

/** Truncate to UTC midnight — the canonical representation for a "day". */
export function toDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameDay(a: Date, b: Date): boolean {
  return toDay(a).getTime() === toDay(b).getTime();
}

/** true if `date` falls within [plan.startDate, plan.endDate) — endDate null = open-ended. */
function planEffectiveOn(plan: TradePlanRow, date: Date): boolean {
  const day = toDay(date).getTime();
  const start = toDay(plan.startDate).getTime();
  if (day < start) return false;
  if (plan.endDate == null) return true;
  return day < toDay(plan.endDate).getTime();
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/**
 * For a given (contractor, trade, date), return the planned count that
 * applies. If two plans overlap, the one with the latest startDate wins
 * (most-recent-plan-of-record). Returns 0 when no plan matches.
 */
export function plannedCountFor(
  plans: TradePlanRow[],
  contractorId: string,
  trade: string,
  date: Date,
): number {
  let winner: TradePlanRow | null = null;
  for (const p of plans) {
    if (p.contractorId !== contractorId) continue;
    if (p.trade !== trade) continue;
    if (!planEffectiveOn(p, date)) continue;
    if (winner == null || p.startDate.getTime() > winner.startDate.getTime()) {
      winner = p;
    }
  }
  return winner ? winner.plannedCount : 0;
}

/**
 * Actual count for (contractor, trade, date). Sums over entries — normal case
 * is exactly one row (enforced by the unique index), but summing is defensive.
 */
export function actualCountFor(
  entries: ManpowerEntryRow[],
  contractorId: string,
  trade: string,
  date: Date,
): number {
  let total = 0;
  for (const e of entries) {
    if (e.contractorId !== contractorId) continue;
    if (e.trade !== trade) continue;
    if (!sameDay(e.entryDate, date)) continue;
    total += e.actualCount;
  }
  return total;
}

/**
 * Build a full day summary for a project: total planned, total actual, and
 * per-contractor-per-trade breakdown. If `contractorId` is given, filters to
 * only that contractor (used by the report's per-contractor sections).
 */
export function daySummary(
  plans: TradePlanRow[],
  entries: ManpowerEntryRow[],
  date: Date,
  contractorId?: string,
): DaySummary {
  // Collect every (contractor, trade) pair we might need to report on:
  // union of pairs that have a plan effective on this date + pairs that
  // logged entries on this date. This makes both "planned but no actual"
  // and "actual with no plan" show up in the breakdown.
  const pairs = new Map<string, { contractorId: string; trade: string }>();
  for (const p of plans) {
    if (contractorId && p.contractorId !== contractorId) continue;
    if (!planEffectiveOn(p, date)) continue;
    pairs.set(`${p.contractorId}::${p.trade}`, { contractorId: p.contractorId, trade: p.trade });
  }
  for (const e of entries) {
    if (contractorId && e.contractorId !== contractorId) continue;
    if (!sameDay(e.entryDate, date)) continue;
    pairs.set(`${e.contractorId}::${e.trade}`, { contractorId: e.contractorId, trade: e.trade });
  }

  const trades: TradeCell[] = [];
  let plannedTotal = 0;
  let actualTotal = 0;
  let hasEntries = false;

  for (const { contractorId: cid, trade } of pairs.values()) {
    const planned = plannedCountFor(plans, cid, trade, date);
    const actual = actualCountFor(entries, cid, trade, date);
    if (actual > 0 || entries.some((e) => e.contractorId === cid && e.trade === trade && sameDay(e.entryDate, date))) {
      hasEntries = true;
    }
    plannedTotal += planned;
    actualTotal += actual;
    trades.push({
      contractorId: cid,
      trade,
      planned,
      actual,
      variance: actual - planned,
      pctOfPlan: planned > 0 ? Math.round((actual / planned) * 100) : null,
    });
  }

  trades.sort((a, b) => {
    if (a.contractorId !== b.contractorId) return a.contractorId.localeCompare(b.contractorId);
    return tradeOrder(a.trade) - tradeOrder(b.trade);
  });

  return {
    date: toDay(date),
    plannedTotal,
    actualTotal,
    variance: actualTotal - plannedTotal,
    pctOfPlan: plannedTotal > 0 ? Math.round((actualTotal / plannedTotal) * 100) : null,
    trades,
    hasEntries,
  };
}

/**
 * Day-by-day summaries across [fromDate, toDate] inclusive. Powers the
 * Weekly Report's 7-day chart + the per-day trade breakdown table.
 */
export function rangeSummary(
  plans: TradePlanRow[],
  entries: ManpowerEntryRow[],
  fromDate: Date,
  toDate: Date,
  contractorId?: string,
): DaySummary[] {
  const start = toDay(fromDate).getTime();
  const end = toDay(toDate).getTime();
  if (end < start) return [];
  const out: DaySummary[] = [];
  const oneDay = 86400000;
  for (let t = start; t <= end; t += oneDay) {
    out.push(daySummary(plans, entries, new Date(t), contractorId));
  }
  return out;
}

/**
 * Compact one-line summary for the Dashboard "Daily Manpower" strip.
 * Shape matches what the UI needs — bring your own formatter.
 */
export function dashboardStrip(
  plans: TradePlanRow[],
  entries: ManpowerEntryRow[],
  date: Date,
  contractorId?: string,
): {
  planned: number;
  actual: number;
  variance: number;
  pctOfPlan: number | null;
  status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
} {
  const s = daySummary(plans, entries, date, contractorId);
  let status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
  if (s.plannedTotal === 0) status = "no-plan";
  else if (!s.hasEntries) status = "not-logged";
  else if (s.variance > 0) status = "above";
  else if (s.variance === 0) status = "on-plan";
  else status = "below";
  return {
    planned: s.plannedTotal,
    actual: s.actualTotal,
    variance: s.variance,
    pctOfPlan: s.pctOfPlan,
    status,
  };
}
