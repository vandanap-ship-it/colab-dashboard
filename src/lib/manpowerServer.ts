// Server-side helpers that fetch manpower rows from Prisma and project them
// into the pure-logic shapes from src/lib/manpower.ts. Keeps DB code out of
// the pure module so tests stay Prisma-free.

import { prisma } from "@/lib/prisma";
import {
  dashboardStrip,
  daySummary,
  rangeSummary,
  toDay,
  type DaySummary,
  type ManpowerEntryRow,
  type TradePlanRow,
} from "@/lib/manpower";

/** Fetch all effective TradePlans + ManpowerEntries around a given day so we can
 *  compute the day summary. Pulls a small buffer around the date (planEndDate
 *  filtering already handles the effective window). */
async function fetchDayData(projectId: string, day: Date): Promise<{
  plans: TradePlanRow[];
  entries: ManpowerEntryRow[];
}> {
  const dayStart = toDay(day);
  const [rawPlans, rawEntries] = await Promise.all([
    prisma.tradePlan.findMany({
      where: {
        projectId,
        deletedAt: null,
        startDate: { lte: dayStart },
        OR: [{ endDate: null }, { endDate: { gt: dayStart } }],
      },
      select: {
        contractorId: true,
        trade: true,
        plannedCount: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        entryDate: dayStart,
        deletedAt: null,
      },
      select: {
        contractorId: true,
        trade: true,
        entryDate: true,
        actualCount: true,
      },
    }),
  ]);
  return {
    plans: rawPlans.map((p) => ({
      contractorId: p.contractorId,
      trade: p.trade,
      plannedCount: p.plannedCount,
      startDate: p.startDate,
      endDate: p.endDate,
    })),
    entries: rawEntries.map((e) => ({
      contractorId: e.contractorId,
      trade: e.trade,
      entryDate: e.entryDate,
      actualCount: e.actualCount,
    })),
  };
}

/** Compact single-day summary for the Dashboard "Daily Manpower" strip.
 *  Never throws — returns a safe zero-planned shape on failure so the
 *  dashboard renders. */
export async function getDashboardManpowerStrip(projectId: string, day: Date = new Date()) {
  try {
    const { plans, entries } = await fetchDayData(projectId, day);
    return dashboardStrip(plans, entries, day);
  } catch (e) {
    console.error("[manpowerServer] getDashboardManpowerStrip failed:", e);
    return {
      planned: 0,
      actual: 0,
      variance: 0,
      pctOfPlan: null as number | null,
      status: "no-plan" as const,
    };
  }
}

/** Full DaySummary for report generators (Master Report Section 4). */
export async function getDaySummary(projectId: string, day: Date, contractorId?: string): Promise<DaySummary> {
  const { plans, entries } = await fetchDayData(projectId, day);
  return daySummary(plans, entries, day, contractorId);
}

/** Range summary for Weekly Report Section 3 (chart + trade breakdown). */
export async function getRangeSummary(
  projectId: string,
  fromDate: Date,
  toDate: Date,
  contractorId?: string,
): Promise<DaySummary[]> {
  const from = toDay(fromDate);
  const to = toDay(toDate);
  const [rawPlans, rawEntries] = await Promise.all([
    prisma.tradePlan.findMany({
      where: {
        projectId,
        deletedAt: null,
        startDate: { lte: to },
        OR: [{ endDate: null }, { endDate: { gt: from } }],
      },
      select: {
        contractorId: true,
        trade: true,
        plannedCount: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        entryDate: { gte: from, lte: to },
        deletedAt: null,
      },
      select: {
        contractorId: true,
        trade: true,
        entryDate: true,
        actualCount: true,
      },
    }),
  ]);
  const plans: TradePlanRow[] = rawPlans.map((p) => ({
    contractorId: p.contractorId,
    trade: p.trade,
    plannedCount: p.plannedCount,
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  const entries: ManpowerEntryRow[] = rawEntries.map((e) => ({
    contractorId: e.contractorId,
    trade: e.trade,
    entryDate: e.entryDate,
    actualCount: e.actualCount,
  }));
  return rangeSummary(plans, entries, fromDate, toDate, contractorId);
}
