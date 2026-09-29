import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { plannedPercentFor } from "@/lib/schedule";
import {
  contractorZoneRollup,
  weightedOverallProgress,
} from "@/lib/masterReportMath";

/**
 * Shared helpers for the report pages — date validation, range parsing, and
 * data fetchers. Each report page is a thin server component on top of these.
 */

export function todayIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

export function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtDateShort(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export function dayKey(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function buildDayList(fromIso: string, toIso: string): string[] {
  const days: string[] = [];
  const cur = new Date(fromIso + "T00:00:00Z");
  const end = new Date(toIso + "T00:00:00Z");
  // Cap at 90 days to keep the page scannable.
  let i = 0;
  while (cur.getTime() <= end.getTime() && i < 90) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    i += 1;
  }
  return days;
}

export function rangeFromSearchParams(params: { from?: string; to?: string }) {
  const to = params.to && isValidIsoDate(params.to) ? params.to : todayIso();
  const from =
    params.from && isValidIsoDate(params.from) ? params.from : daysAgoIso(13);
  // Normalize so "from" is the earlier date.
  if (from > to) return { from: to, to: from };
  return { from, to };
}

// ----- Project header info helper -----

export async function getProjectMeta(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true, address: true, tagline: true },
  });
}

// ----- Labour Supply Report -----

export type LabourSupplyReport = {
  days: string[]; // YYYY-MM-DD
  contractors: Array<{
    contractorId: string | null;
    contractorName: string;
    rows: Array<{
      category: string;
      perDay: number[]; // length === days.length
      total: number;
    }>;
    totalsPerDay: number[];
    grandTotal: number;
  }>;
  grandTotalPerDay: number[];
  grandTotal: number;
};

export async function getLabourSupplyReport(
  projectId: string,
  fromIso: string,
  toIso: string,
): Promise<LabourSupplyReport> {
  const days = buildDayList(fromIso, toIso);
  const start = new Date(fromIso + "T00:00:00Z");
  const endExclusive = new Date(toIso + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: start, lt: endExclusive } },
    select: {
      id: true,
      date: true,
      contractor: { select: { id: true, name: true } },
    },
  });

  const ids = entries.map((e) => e.id);
  const labourRows = ids.length
    ? await prisma.progressLabour.findMany({
        where: { progressEntryId: { in: ids } },
        select: { progressEntryId: true, category: true, count: true },
      })
    : [];

  const labourByEntry = new Map<string, { category: string; count: number }[]>();
  for (const l of labourRows) {
    const arr = labourByEntry.get(l.progressEntryId) ?? [];
    arr.push({ category: l.category, count: l.count });
    labourByEntry.set(l.progressEntryId, arr);
  }

  type Cell = Map<string, number>; // category -> count
  type Group = { contractorId: string | null; name: string; perDayCategory: Map<string, Cell> };
  const groups = new Map<string, Group>();

  for (const e of entries) {
    const key = dayKey(e.date);
    if (!days.includes(key)) continue;
    const cName = e.contractor?.name ?? "(unassigned)";
    const cId = e.contractor?.id ?? null;
    const groupKey = cId ?? `__unassigned__::${cName}`;
    let g = groups.get(groupKey);
    if (!g) {
      g = { contractorId: cId, name: cName, perDayCategory: new Map() };
      groups.set(groupKey, g);
    }
    const labours = labourByEntry.get(e.id) ?? [];
    let cell = g.perDayCategory.get(key);
    if (!cell) {
      cell = new Map();
      g.perDayCategory.set(key, cell);
    }
    for (const l of labours) {
      cell.set(l.category, (cell.get(l.category) ?? 0) + l.count);
    }
  }

  const contractors: LabourSupplyReport["contractors"] = [];
  const grandTotalPerDay = days.map(() => 0);
  let grandTotal = 0;

  for (const g of Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))) {
    const categories = new Set<string>();
    for (const cell of g.perDayCategory.values()) {
      for (const cat of cell.keys()) categories.add(cat);
    }
    const sortedCategories = Array.from(categories).sort();

    const rows = sortedCategories.map((cat) => {
      const perDay = days.map((d) => {
        const cell = g.perDayCategory.get(d);
        return cell?.get(cat) ?? 0;
      });
      const total = perDay.reduce((s, n) => s + n, 0);
      return { category: cat, perDay, total };
    });

    const totalsPerDay = days.map((_, i) =>
      rows.reduce((s, r) => s + r.perDay[i], 0),
    );
    const groupGrand = totalsPerDay.reduce((s, n) => s + n, 0);

    for (let i = 0; i < days.length; i++) {
      grandTotalPerDay[i] += totalsPerDay[i];
    }
    grandTotal += groupGrand;

    contractors.push({
      contractorId: g.contractorId,
      contractorName: g.name,
      rows,
      totalsPerDay,
      grandTotal: groupGrand,
    });
  }

  return { days, contractors, grandTotalPerDay, grandTotal };
}

// ----- Master Observation Report -----

export type ObservationReport = {
  range: { from: string; to: string };
  totals: {
    issuesNew: number;
    issuesResolved: number;
    issuesOpenAtEnd: number;
    inspectionsNew: number;
    inspectionsPassed: number;
    inspectionsRejected: number;
    inspectionsInReview: number;
    concernsNew: number;
    concernsResolved: number;
    hindrancesNew: number;
    hindrancesResolved: number;
  };
  issues: Array<{
    id: string;
    description: string;
    severity: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    contractor: string | null;
    activity: string | null;
  }>;
  inspections: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    reviewedAt: Date | null;
    contractor: string | null;
    activity: string | null;
  }>;
  concerns: Array<{
    id: string;
    description: string;
    status: string;
    createdAt: Date;
    activity: string | null;
  }>;
  hindrances: Array<{
    id: string;
    description: string;
    status: string;
    createdAt: Date;
    daysImpact: number | null;
    activity: string | null;
  }>;
};

export async function getObservationReport(
  projectId: string,
  fromIso: string,
  toIso: string,
): Promise<ObservationReport> {
  const start = new Date(fromIso + "T00:00:00Z");
  const endExclusive = new Date(toIso + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const [
    issues,
    inspections,
    concerns,
    hindrances,
    issuesOpenAtEnd,
    inspectionsInReview,
  ] = await Promise.all([
    prisma.issue.findMany({
      where: {
        projectId,
        OR: [
          { createdAt: { gte: start, lt: endExclusive } },
          { updatedAt: { gte: start, lt: endExclusive } },
        ],
      },
      select: {
        id: true,
        description: true,
        severity: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        wbsNode: {
          select: { name: true, contractor: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.inspection.findMany({
      where: {
        projectId,
        OR: [
          { createdAt: { gte: start, lt: endExclusive } },
          { reviewedAt: { gte: start, lt: endExclusive } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        wbsNode: {
          select: { name: true, contractor: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.concern.findMany({
      where: {
        projectId,
        OR: [
          { createdAt: { gte: start, lt: endExclusive } },
          { updatedAt: { gte: start, lt: endExclusive } },
        ],
      },
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        wbsNode: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.hindrance.findMany({
      where: {
        projectId,
        OR: [
          { createdAt: { gte: start, lt: endExclusive } },
          { updatedAt: { gte: start, lt: endExclusive } },
        ],
      },
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        daysImpact: true,
        wbsNode: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.issue.count({
      where: { projectId, status: "OPEN", createdAt: { lt: endExclusive } },
    }),
    prisma.inspection.count({
      where: {
        projectId,
        status: "IN_REVIEW",
        createdAt: { lt: endExclusive },
      },
    }),
  ]);

  const issuesNew = issues.filter(
    (i) => i.createdAt >= start && i.createdAt < endExclusive,
  ).length;
  const issuesResolved = issues.filter(
    (i) =>
      i.status === "RESOLVED" &&
      i.updatedAt >= start &&
      i.updatedAt < endExclusive,
  ).length;
  const inspectionsNew = inspections.filter(
    (i) => i.createdAt >= start && i.createdAt < endExclusive,
  ).length;
  const inspectionsPassed = inspections.filter(
    (i) =>
      i.status === "PASSED" &&
      i.reviewedAt &&
      i.reviewedAt >= start &&
      i.reviewedAt < endExclusive,
  ).length;
  const inspectionsRejected = inspections.filter(
    (i) =>
      i.status === "REJECTED" &&
      i.reviewedAt &&
      i.reviewedAt >= start &&
      i.reviewedAt < endExclusive,
  ).length;
  const concernsNew = concerns.filter(
    (c) => c.createdAt >= start && c.createdAt < endExclusive,
  ).length;
  const concernsResolved = concerns.filter(
    (c) => c.status === "RESOLVED",
  ).length;
  const hindrancesNew = hindrances.filter(
    (h) => h.createdAt >= start && h.createdAt < endExclusive,
  ).length;
  const hindrancesResolved = hindrances.filter(
    (h) => h.status === "RESOLVED",
  ).length;

  return {
    range: { from: fromIso, to: toIso },
    totals: {
      issuesNew,
      issuesResolved,
      issuesOpenAtEnd,
      inspectionsNew,
      inspectionsPassed,
      inspectionsRejected,
      inspectionsInReview,
      concernsNew,
      concernsResolved,
      hindrancesNew,
      hindrancesResolved,
    },
    issues: issues.map((i) => ({
      id: i.id,
      description: i.description,
      severity: i.severity,
      status: i.status,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      contractor: i.wbsNode?.contractor?.name ?? null,
      activity: i.wbsNode?.name ?? null,
    })),
    inspections: inspections.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      createdAt: i.createdAt,
      reviewedAt: i.reviewedAt,
      contractor: i.wbsNode?.contractor?.name ?? null,
      activity: i.wbsNode?.name ?? null,
    })),
    concerns: concerns.map((c) => ({
      id: c.id,
      description: c.description,
      status: c.status,
      createdAt: c.createdAt,
      activity: c.wbsNode?.name ?? null,
    })),
    hindrances: hindrances.map((h) => ({
      id: h.id,
      description: h.description,
      status: h.status,
      createdAt: h.createdAt,
      daysImpact: h.daysImpact,
      activity: h.wbsNode?.name ?? null,
    })),
  };
}

// ----- Contractor Work Summary -----

export type ContractorWorkSummary = {
  range: { from: string; to: string };
  rows: Array<{
    contractorId: string | null;
    contractorName: string;
    activitiesUpdated: number; // distinct WBS nodes touched
    progressEntries: number;
    totalLabour: number;
    inspectionsTotal: number;
    inspectionsPassed: number;
    inspectionsRejected: number;
    issuesOpen: number;
    issuesResolved: number;
  }>;
};

export async function getContractorWorkSummary(
  projectId: string,
  fromIso: string,
  toIso: string,
): Promise<ContractorWorkSummary> {
  const start = new Date(fromIso + "T00:00:00Z");
  const endExclusive = new Date(toIso + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: start, lt: endExclusive } },
    select: {
      id: true,
      wbsNodeId: true,
      contractor: { select: { id: true, name: true } },
    },
  });
  const ids = entries.map((e) => e.id);
  const labourRows = ids.length
    ? await prisma.progressLabour.findMany({
        where: { progressEntryId: { in: ids } },
        select: { progressEntryId: true, count: true },
      })
    : [];
  const labourByEntry = new Map<string, number>();
  for (const l of labourRows) {
    labourByEntry.set(
      l.progressEntryId,
      (labourByEntry.get(l.progressEntryId) ?? 0) + l.count,
    );
  }

  type Agg = {
    contractorId: string | null;
    name: string;
    activitiesSet: Set<string>;
    progressEntries: number;
    totalLabour: number;
    inspectionsTotal: number;
    inspectionsPassed: number;
    inspectionsRejected: number;
    issuesOpen: number;
    issuesResolved: number;
  };
  const map = new Map<string, Agg>();
  function get(cId: string | null, cName: string): Agg {
    const k = cId ?? `__unassigned__::${cName}`;
    let a = map.get(k);
    if (!a) {
      a = {
        contractorId: cId,
        name: cName,
        activitiesSet: new Set(),
        progressEntries: 0,
        totalLabour: 0,
        inspectionsTotal: 0,
        inspectionsPassed: 0,
        inspectionsRejected: 0,
        issuesOpen: 0,
        issuesResolved: 0,
      };
      map.set(k, a);
    }
    return a;
  }

  for (const e of entries) {
    const a = get(e.contractor?.id ?? null, e.contractor?.name ?? "(unassigned)");
    a.activitiesSet.add(e.wbsNodeId);
    a.progressEntries += 1;
    a.totalLabour += labourByEntry.get(e.id) ?? 0;
  }

  const inspections = await prisma.inspection.findMany({
    where: {
      projectId,
      OR: [
        { createdAt: { gte: start, lt: endExclusive } },
        { reviewedAt: { gte: start, lt: endExclusive } },
      ],
    },
    select: {
      id: true,
      status: true,
      wbsNode: { select: { contractor: { select: { id: true, name: true } } } },
    },
  });
  for (const i of inspections) {
    const c = i.wbsNode?.contractor;
    const a = get(c?.id ?? null, c?.name ?? "(unassigned)");
    a.inspectionsTotal += 1;
    if (i.status === "PASSED") a.inspectionsPassed += 1;
    if (i.status === "REJECTED") a.inspectionsRejected += 1;
  }

  const issues = await prisma.issue.findMany({
    where: {
      projectId,
      OR: [
        { createdAt: { gte: start, lt: endExclusive } },
        { updatedAt: { gte: start, lt: endExclusive } },
      ],
    },
    select: {
      id: true,
      status: true,
      wbsNode: { select: { contractor: { select: { id: true, name: true } } } },
    },
  });
  for (const i of issues) {
    const c = i.wbsNode?.contractor;
    const a = get(c?.id ?? null, c?.name ?? "(unassigned)");
    if (i.status === "OPEN") a.issuesOpen += 1;
    if (i.status === "RESOLVED") a.issuesResolved += 1;
  }

  const rows = Array.from(map.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({
      contractorId: a.contractorId,
      contractorName: a.name,
      activitiesUpdated: a.activitiesSet.size,
      progressEntries: a.progressEntries,
      totalLabour: a.totalLabour,
      inspectionsTotal: a.inspectionsTotal,
      inspectionsPassed: a.inspectionsPassed,
      inspectionsRejected: a.inspectionsRejected,
      issuesOpen: a.issuesOpen,
      issuesResolved: a.issuesResolved,
    }));

  return { range: { from: fromIso, to: toIso }, rows };
}

// ============================================================
// ----- Master Report (weekly / branded) -----
// ============================================================

export type MasterReportData = {
  overall: {
    plannedPercent: number;
    achievedPercent: number;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    reraEndDate: Date | null;
    actualStart: Date | null;
    projectedEnd: Date | null;
    plannedDurationDays: number | null;
    projectedDurationDays: number | null;
    totalDelayDays: number;
    reraDelayDays: number;
    hindrancesOpen: number;
    // Location-wise delay: weighted mean of per-villa delay in days.
    // Signed: negative = villas trending ahead of schedule, positive = late.
    // Amanvana target from Colab Project Dashboard: -5 Days.
    locationDelayDays: number;
    // Total hindrance duration across all hindrances on this project, in
    // milliseconds — what Colab surfaces as "RERA Delay" with day/hr/min
    // precision (e.g. Amanvana today = 7d 7h 11min). Rendered by the page
    // via formatDurationDHM. Not the same as reraDelayDays (which is a
    // date-diff from RERA end date — kept for backward compatibility).
    hindranceDurationMs: number;
  };
  perZone: Array<{
    id: string;
    name: string;
    plannedStart: Date | null;
    plannedFinish: Date | null;
    plannedDurationDays: number | null;
    actualStart: Date | null;
    projectedFinish: Date | null;
    actualDurationDays: number | null;
    actualPercent: number;
    totalDelayDays: number;
    hindrancesCount: number;
  }>;
  totalActivities: Array<{
    id: string;
    name: string;
    location: string; // "Phase / Floor"
    plannedPercent: number;
    actualPercent: number;
    delayReason: string | null;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    projectedEnd: Date | null;
  }>;
};

/**
 * Master Report — weekly progress.
 *
 * Header data (overall, per-zone) is "current state" — date range is purely
 * for the report header. Total activities table also reflects current state.
 *
 * Wrapped in `unstable_cache` because the underlying full-tree WBSNode scan
 * costs ~10 seconds for Amanvana (~14k rows), and the result changes at
 * daily/weekly cadence — a 60-second freshness window is invisible to
 * users but drops repeat renders to <100ms. To make it strictly-fresh on
 * write, wire `revalidateTag('master-report:<projectId>')` into the
 * progress/hindrance/etc. POST/PATCH/DELETE handlers.
 */
async function getMasterReportUncached(
  projectId: string,
  fromIso: string,
  toIso: string,
  today = new Date(),
): Promise<MasterReportData> {
  // Period-relevance filter — see the Section 04 filter below. Parse once,
  // treat missing / invalid dates as "no filter" so the report still renders.
  const rangeFrom = fromIso ? new Date(fromIso + "T00:00:00Z") : null;
  const rangeTo = toIso ? new Date(toIso + "T23:59:59Z") : null;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { startDate: true, endDate: true, reraEndDate: true },
  });

  const allNodes = await prisma.wBSNode.findMany({
    where: { projectId },
    select: {
      id: true,
      parentId: true,
      name: true,
      level: true,
      baselineStart: true,
      baselineFinish: true,
      actualStart: true,
      actualFinish: true,
      projectedFinish: true,
      percentComplete: true,
      progressEntered: true,
      delayReason: true,
      weightPct: true, // per-activity weight from Colab's Physical_Progress column
      contractorId: true, // needed for the contractor-zone fallback below
    },
  });

  const childrenOf = new Map<string, typeof allNodes>();
  for (const n of allNodes) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n);
    childrenOf.set(n.parentId, arr);
  }
  const isLeaf = (id: string) => !childrenOf.has(id) || childrenOf.get(id)!.length === 0;
  const leaves = allNodes.filter((n) => isLeaf(n.id));

  // Phases = level-1 nodes (children of project root)
  const phases = allNodes.filter((n) => n.level === 1);

  function leavesUnder(parentId: string): typeof allNodes {
    const out: typeof allNodes = [];
    const stack = [parentId];
    while (stack.length) {
      const cur = stack.pop()!;
      const kids = childrenOf.get(cur) ?? [];
      for (const k of kids) {
        if (isLeaf(k.id)) out.push(k);
        else stack.push(k.id);
      }
    }
    return out;
  }

  function diffDays(a: Date | null, b: Date | null): number | null {
    if (!a || !b) return null;
    return Math.round((a.getTime() - b.getTime()) / 86_400_000);
  }

  // ---- Overall ----
  const projectStart = project?.startDate ?? null;
  const projectEnd = project?.endDate ?? null;
  const reraEnd = project?.reraEndDate ?? null;

  const earliestActual = leaves
    .map((l) => l.actualStart)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // Latest projected end.
  //
  // Preferred path: MAX(actualEnd, plannedEnd) across every ColabActivity
  // row. Colab's plannedEnd on the last-scheduled activity per villa is
  // the site team's own answer to "when will this villa finish", and
  // matches the projected end in Colab's dashboards + exports.
  //
  // The old WBSNode-based path returned Dec 2028 on Amanvana because the
  // Colab importer overwrites WBSNode.baselineFinish on match, and every
  // matched leaf carried a Colab-planned end that fell before Elegant's
  // MPP's true Mar 2029 finish — the max then ignored the unmatched MPP
  // leaves that still had the correct baselineFinish.
  //
  // Fallback (no ColabActivity yet): the historic leaf-based reduce,
  // which still holds for MPP-only projects.
  let latestProjected: Date | null = null;
  const latestProjectedFromColab = await prisma.$queryRawUnsafe<
    Array<{ latest: Date | null }>
  >(
    `SELECT GREATEST(MAX("actualEnd"), MAX("plannedEnd")) AS latest
     FROM "ColabActivity"
     WHERE "projectId" = $1`,
    projectId,
  );
  if (latestProjectedFromColab[0]?.latest) {
    latestProjected = latestProjectedFromColab[0].latest;
  } else {
    latestProjected = leaves.reduce<Date | null>((max, l) => {
      const cand = l.actualFinish ?? l.projectedFinish ?? l.baselineFinish;
      if (!cand) return max;
      return !max || cand > max ? cand : max;
    }, null);
  }

  // Overall progress %.
  //
  // Preferred path (Colab-parity): aggregate straight from ColabActivity
  // rows using Colab's own Physical_Progress (weight), Planned_Progress_%
  // and Total_Progress_% columns:
  //   overallPlanned  = SUM(physicalProgress × plannedPct) / SUM(physicalProgress)
  //   overallAchieved = SUM(physicalProgress × totalPct)   / SUM(physicalProgress)
  // This is what Colab's own Project Dashboard uses (2.44% / 1.58% on
  // Amanvana today) — the number site leads and board reports run on.
  // Simple mean of the same rows produces ~7.4% / 11.6%, which matches
  // Excel pivots but not the number Colab shows the site team.
  //
  // Fallback (fresh MPP-only project, no Colab data): the historic
  // WBSNode-weighted path, computing planned% from baseline dates.
  const overallColab = await prisma.$queryRawUnsafe<
    Array<{ planned_num: number | null; achieved_num: number | null; weight_sum: number | null }>
  >(
    `SELECT
       SUM("physicalProgress" * COALESCE("plannedPct", 0)) AS planned_num,
       SUM("physicalProgress" * COALESCE("totalPct",   0)) AS achieved_num,
       SUM("physicalProgress")                              AS weight_sum
     FROM "ColabActivity"
     WHERE "projectId" = $1
       AND "physicalProgress" > 0`,
    projectId,
  );
  const cAgg = overallColab[0];
  const totalWeight = Number(cAgg?.weight_sum ?? 0);
  let overallPlanned: number;
  let overallAchieved: number;
  if (totalWeight > 0) {
    overallPlanned  = Number(cAgg?.planned_num ?? 0) / totalWeight;
    overallAchieved = Number(cAgg?.achieved_num ?? 0) / totalWeight;
  } else {
    // No ColabActivity rows yet — fall back to the leaf-based weighted
    // math so freshly-imported MPP-only projects still show a number.
    const fallback = weightedOverallProgress(leaves, today);
    overallPlanned  = fallback.planned;
    overallAchieved = fallback.achieved;
  }

  // Signed: positive = days late, negative = days ahead, 0 = on the day.
  // Previously clamped at 0 which made "ahead of schedule" look identical to
  // "exactly on time" — sites that worked hard to finish early got no credit
  // on the board report.
  const totalDelayDays =
    projectEnd && latestProjected ? (diffDays(latestProjected, projectEnd) ?? 0) : 0;
  const reraDelayDays =
    reraEnd && latestProjected ? (diffDays(latestProjected, reraEnd) ?? 0) : 0;

  const hindrancesOpen = await prisma.hindrance.count({
    where: { projectId, status: "OPEN" },
  });

  // Location-wise delay: for each villa (with any ColabActivity progress),
  // compute (max projected/actual end) − (max planned end), then arithmetic
  // mean across villas. Signed days, negative = ahead. Falls back to 0 when
  // no ColabActivity rows exist yet.
  const locationDelayAgg = await prisma.$queryRawUnsafe<
    Array<{ avg_delay: number | null }>
  >(
    `SELECT AVG(delay_days)::float AS avg_delay FROM (
       SELECT
         "villaId",
         EXTRACT(
           EPOCH FROM (
             MAX(COALESCE("actualEnd", "plannedEnd")) - MAX("plannedEnd")
           )
         ) / 86400.0 AS delay_days
       FROM "ColabActivity"
       WHERE "projectId" = $1
         AND "villaId" IS NOT NULL
         AND "physicalProgress" > 0
       GROUP BY "villaId"
     ) t`,
    projectId,
  );
  const locationDelayDays = Math.round(Number(locationDelayAgg[0]?.avg_delay ?? 0));

  // Total hindrance duration in milliseconds — feeds the "RERA Delay" card
  // with day/hr/min precision (Colab's Project Dashboard shows Amanvana as
  // 7d 7h 11min today). Uses resolvedDate when present, otherwise endDate,
  // otherwise "now" for still-open hindrances.
  const hindranceDurationAgg = await prisma.$queryRawUnsafe<
    Array<{ total_seconds: number | null }>
  >(
    `SELECT COALESCE(SUM(
       EXTRACT(
         EPOCH FROM (
           COALESCE("resolvedDate", "endDate", NOW()) - "startDate"
         )
       )
     ), 0)::float AS total_seconds
     FROM "Hindrance"
     WHERE "projectId" = $1
       AND "deletedAt" IS NULL`,
    projectId,
  );
  const hindranceDurationMs = Math.max(
    0,
    Math.round(Number(hindranceDurationAgg[0]?.total_seconds ?? 0) * 1000),
  );

  const overall: MasterReportData["overall"] = {
    plannedPercent: Math.round(overallPlanned * 100) / 100,
    achievedPercent: Math.round(overallAchieved * 100) / 100,
    plannedStart: projectStart,
    plannedEnd: projectEnd,
    reraEndDate: reraEnd,
    actualStart: earliestActual,
    projectedEnd: latestProjected,
    plannedDurationDays: diffDays(projectEnd, projectStart),
    projectedDurationDays: diffDays(latestProjected, projectStart),
    totalDelayDays,
    reraDelayDays,
    hindrancesOpen,
    locationDelayDays,
    hindranceDurationMs,
  };

  // ---- Per zone (= phase) ----
  const perZone: MasterReportData["perZone"] = [];
  const hindranceCountsByPhase = new Map<string, number>();
  // Build a quick lookup: each leaf's ancestor phase ID
  const phaseIdByLeaf = new Map<string, string>();
  for (const phase of phases) {
    for (const l of leavesUnder(phase.id)) phaseIdByLeaf.set(l.id, phase.id);
  }
  const hindrances = await prisma.hindrance.findMany({
    where: { projectId },
    select: { wbsNodeId: true },
  });
  for (const h of hindrances) {
    if (!h.wbsNodeId) continue;
    const phaseId = phaseIdByLeaf.get(h.wbsNodeId);
    if (phaseId) hindranceCountsByPhase.set(phaseId, (hindranceCountsByPhase.get(phaseId) ?? 0) + 1);
  }

  for (const phase of phases) {
    const phaseLeaves = leavesUnder(phase.id);
    const actualPercent =
      phaseLeaves.length === 0
        ? phase.percentComplete
        : phaseLeaves.reduce((s, l) => s + (l.percentComplete ?? 0), 0) / phaseLeaves.length;

    const phaseProjected =
      phaseLeaves
        .map((l) => l.projectedFinish ?? l.actualFinish)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? phase.projectedFinish ?? phase.baselineFinish;

    // Signed (same convention as overall): positive = late, negative = ahead.
    const phaseTotalDelay =
      phase.baselineFinish && phaseProjected
        ? (diffDays(phaseProjected, phase.baselineFinish) ?? 0)
        : 0;

    perZone.push({
      id: phase.id,
      name: phase.name,
      plannedStart: phase.baselineStart,
      plannedFinish: phase.baselineFinish,
      plannedDurationDays: diffDays(phase.baselineFinish, phase.baselineStart),
      actualStart: phase.actualStart,
      projectedFinish: phaseProjected,
      actualDurationDays: diffDays(phaseProjected, phase.actualStart ?? phase.baselineStart),
      actualPercent: Math.round(actualPercent * 100) / 100,
      totalDelayDays: phaseTotalDelay,
      hindrancesCount: hindranceCountsByPhase.get(phase.id) ?? 0,
    });
  }

  // ---- Contractor-zone fallback -----------------------------------------
  // Amanvana (and many Colab-imported schedules) come in as a SINGLE level-1
  // phase node — "Villa Set (V32, V33)" for us. That leaves §02 showing one
  // row for the whole 93-villa project, which reads as if the report is
  // broken.
  //
  // When we detect that pattern (<=1 phase but multiple contractors with
  // leaves), rebuild perZone off contractor-attributed leaves instead. Every
  // contractor becomes its own zone row with roll-up dates, %, delay and
  // hindrance count — matches how the site team actually talks about the
  // work anyway (Abraham's villas vs Elegant's villas).
  //
  // Kept the phase-based path above intact so multi-phase projects (Phase 1
  // / Phase 2) still get proper phase rollups; the fallback replaces perZone
  // only when the phase view has nothing useful to show.
  const contractorGroups = new Map<string, { name: string; leaves: typeof leaves }>();
  for (const l of leaves) {
    if (!l.contractorId) continue;
    if (!contractorGroups.has(l.contractorId)) {
      contractorGroups.set(l.contractorId, { name: "", leaves: [] });
    }
    contractorGroups.get(l.contractorId)!.leaves.push(l);
  }
  if (phases.length <= 1 && contractorGroups.size >= 2) {
    // Resolve contractor names in one round-trip.
    const contractorRows = await prisma.contractor.findMany({
      where: { id: { in: [...contractorGroups.keys()] } },
      select: { id: true, name: true },
    });
    const nameByContractorId = new Map(contractorRows.map((c) => [c.id, c.name]));

    // Hindrances grouped by contractor via the WBS leaf they hang off of.
    const contractorByLeafId = new Map<string, string>();
    for (const [cid, g] of contractorGroups) {
      for (const l of g.leaves) contractorByLeafId.set(l.id, cid);
    }
    const hindranceCountsByContractor = new Map<string, number>();
    for (const h of hindrances) {
      if (!h.wbsNodeId) continue;
      const cid = contractorByLeafId.get(h.wbsNodeId);
      if (cid) hindranceCountsByContractor.set(cid, (hindranceCountsByContractor.get(cid) ?? 0) + 1);
    }

    // Replace perZone in place with contractor-attributed zones.
    perZone.length = 0;
    const contractorIds = [...contractorGroups.keys()].sort((a, b) =>
      (nameByContractorId.get(a) ?? "").localeCompare(nameByContractorId.get(b) ?? ""),
    );
    for (const cid of contractorIds) {
      const g = contractorGroups.get(cid)!;
      const cName = nameByContractorId.get(cid) ?? "Untagged";
      const rollup = contractorZoneRollup(g.leaves);
      perZone.push({
        id: cid,
        name: cName,
        ...rollup,
        hindrancesCount: hindranceCountsByContractor.get(cid) ?? 0,
      });
    }
  }

  // ---- Total activities — sourced from ColabActivity for Colab parity ----
  //
  // Previous implementation walked the WBSNode parent chain to build the
  // Location breadcrumb, but our MSP importer creates leaf-only WBSNodes
  // (no block/villa parent WBSNodes), so every leaf's parent chain was
  // empty and Location showed as "—". The old path also read planned %
  // from MPP baseline dates and actual % from WBSNode.percentComplete,
  // both of which drift from Colab's Total_Progress_% / Planned_Progress_%.
  //
  // New path: iterate ColabActivity, resolve villa label + section name
  // from lookup maps, use Colab's own dates + planned/actual % / reason.
  // Falls back to the old leaf-based path when no ColabActivity rows
  // exist (fresh MPP-only project), so a picker still shows activities
  // pre-Colab-import.
  const [colabActivityRows, villaRowsForActivities, sectionRowsForActivities] = await Promise.all([
    prisma.colabActivity.findMany({
      where: { projectId },
      select: {
        id: true,
        villaId: true,
        sectionId: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        progressDate: true,
        totalPct: true,
        plannedPct: true,
        reasonNote: true,
        rawColabRow: true,
      },
    }),
    prisma.villa.findMany({
      where: { projectId },
      select: { id: true, number: true, label: true },
    }),
    prisma.milestoneSection.findMany({
      where: { projectId },
      select: { id: true, name: true, orderIndex: true },
    }),
  ]);
  const villaLabelById2 = new Map(
    villaRowsForActivities.map((v) => [v.id, v.label ?? `Villa ${v.number}`]),
  );
  const villaNumberById = new Map(villaRowsForActivities.map((v) => [v.id, v.number]));
  const sectionNameById = new Map(sectionRowsForActivities.map((s) => [s.id, s.name]));
  const sectionOrderById = new Map(sectionRowsForActivities.map((s) => [s.id, s.orderIndex]));

  // Normalise a delay reason: trim, drop trailing "." / "-", collapse
  // whitespace, treat "." or "-" alone as blank. Case is preserved so
  // the site team's typing style stays recognisable.
  function normalizeReason(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const s = raw.replace(/\s+/g, " ").trim().replace(/[.\s]+$/g, "");
    if (!s || s === "." || s === "-") return null;
    return s;
  }

  // Filter activities that overlap the report window. Same overlap rule
  // as the old path — an activity is "in play" if its planned OR actual
  // window intersects [rangeFrom, rangeTo]. Unbounded rows pass through.
  function overlapsRangeColab(r: { plannedStart: Date | null; plannedEnd: Date | null; actualStart: Date | null; actualEnd: Date | null; projectedFinish?: Date | null }): boolean {
    if (!rangeFrom || !rangeTo) return true;
    const start = r.plannedStart ?? r.actualStart;
    const end = r.actualEnd ?? r.plannedEnd ?? null;
    if (!start && !end) return true;
    if (start && start.getTime() > rangeTo.getTime()) return false;
    if (end && end.getTime() < rangeFrom.getTime()) return false;
    return true;
  }

  let totalActivities: MasterReportData["totalActivities"];
  if (colabActivityRows.length > 0) {
    totalActivities = colabActivityRows
      .filter(overlapsRangeColab)
      .map((r) => {
        const raw = (r.rawColabRow ?? {}) as Record<string, string | undefined | null>;
        const villaLabel = r.villaId ? villaLabelById2.get(r.villaId) ?? "" : "";
        const sectionName = r.sectionId ? sectionNameById.get(r.sectionId) ?? "" : "";
        // Prefer Colab's own Activity_Name so the row's naming matches the
        // raw CSV export; fall back to composing from Sub_Location +
        // Activity_Head where Activity_Name is a stub like "Works".
        const activityName =
          (raw["Activity_Name"] && raw["Activity_Name"].trim()) ||
          [raw["Sub_Location"], raw["Activity_Head"]].filter(Boolean).join(" — ") ||
          "(unnamed activity)";
        return {
          id: r.id,
          name: activityName,
          location: [villaLabel, sectionName].filter(Boolean).join(" · ") || "—",
          plannedPercent: Math.round((r.plannedPct ?? 0) * 100) / 100,
          actualPercent: Math.round((r.totalPct ?? 0) * 100) / 100,
          delayReason: normalizeReason(r.reasonNote),
          plannedStart: r.plannedStart,
          plannedEnd: r.plannedEnd,
          projectedEnd: r.actualEnd,
          _sortVilla: r.villaId ? villaNumberById.get(r.villaId) ?? 9999 : 9999,
          _sortSection: r.sectionId ? sectionOrderById.get(r.sectionId) ?? 999 : 999,
        };
      })
      .sort((a, b) => a._sortVilla - b._sortVilla || a._sortSection - b._sortSection || a.name.localeCompare(b.name))
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ _sortVilla: _v, _sortSection: _s, ...rest }) => rest);
  } else {
    // Fallback — no Colab data yet, iterate WBSNode leaves the old way
    // but read villa label from the villa map (safer than the parent
    // chain walk which was broken for MSP-imported schedules).
    const overlapsRange = (l: (typeof leaves)[number]): boolean => {
      if (!rangeFrom || !rangeTo) return true;
      const start = l.baselineStart ?? l.actualStart;
      const end = l.actualFinish ?? l.projectedFinish ?? l.baselineFinish;
      if (!start && !end) return true;
      if (start && start.getTime() > rangeTo.getTime()) return false;
      if (end && end.getTime() < rangeFrom.getTime()) return false;
      return true;
    };
    totalActivities = leaves
      .filter(overlapsRange)
      .map((l) => ({
        id: l.id,
        name: l.name,
        location: "—",
        plannedPercent: Math.round(plannedPercentFor(l.baselineStart, l.baselineFinish, today) * 100) / 100,
        actualPercent: Math.round((l.percentComplete ?? 0) * 100) / 100,
        delayReason: normalizeReason(l.delayReason),
        plannedStart: l.baselineStart,
        plannedEnd: l.baselineFinish,
        projectedEnd: l.projectedFinish ?? l.actualFinish,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return { overall, perZone, totalActivities };
}

/**
 * Cached wrapper. The `today` param is intentionally excluded from the cache
 * key — callers should trust the tag-based invalidation and a 60-second TTL.
 * If we cached per-timestamp, every request would miss.
 */
export const getMasterReport = unstable_cache(
  async (projectId: string, fromIso: string, toIso: string, todayIso?: string) => {
    return getMasterReportUncached(
      projectId,
      fromIso,
      toIso,
      todayIso ? new Date(todayIso) : undefined,
    );
  },
  ["master-report"],
  { revalidate: 60 },
);

// ============================================================
// ----- Checklist Report (inspections list) -----
// ============================================================

export type ChecklistReportRow = {
  id: string;
  title: string;
  status: "IN_REVIEW" | "PASSED" | "REJECTED";
  rejectionReason: string | null;
  location: string;
  contractorName: string | null;
  filledByName: string | null;
  reviewedByName: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  itemsTotal: number;
  itemsPassed: number;
};

export type ChecklistReportData = {
  range: { from: string; to: string };
  totals: {
    total: number;
    inReview: number;
    passed: number;
    rejected: number;
    successRate: number; // % of decided that passed
  };
  rows: ChecklistReportRow[];
};

export async function getChecklistReport(
  projectId: string,
  fromIso: string,
  toIso: string,
): Promise<ChecklistReportData> {
  const start = new Date(fromIso + "T00:00:00Z");
  const end = new Date(toIso + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);

  const inspections = await prisma.inspection.findMany({
    where: { projectId, createdAt: { gte: start, lt: end } },
    orderBy: [{ createdAt: "desc" }],
    include: {
      filledBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      wbsNode: {
        select: {
          name: true,
          parentId: true,
          contractor: { select: { name: true } },
        },
      },
      items: { select: { passed: true } },
    },
  });

  // Build location breadcrumbs (Phase / Floor / …)
  const allNodes = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true, level: true },
  });
  const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
  const levelById = new Map(allNodes.map((n) => [n.id, n.level]));
  const parentById = new Map(allNodes.map((n) => [n.id, n.parentId]));
  function locationFor(leafId: string | null | undefined): string {
    if (!leafId) return "—";
    const parts: string[] = [nameById.get(leafId) ?? ""];
    let cur = parentById.get(leafId) ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      const lvl = levelById.get(cur);
      const nm = nameById.get(cur);
      if (lvl != null && lvl >= 1 && nm) parts.push(nm);
      cur = parentById.get(cur) ?? null;
      depth += 1;
    }
    return parts.reverse().filter(Boolean).join(" / ") || "—";
  }

  const rows: ChecklistReportRow[] = inspections.map((i) => {
    const itemsTotal = i.items.length;
    const itemsPassed = i.items.filter((x) => x.passed).length;
    const status = (
      i.status === "PASSED" || i.status === "REJECTED" || i.status === "IN_REVIEW"
        ? i.status
        : "IN_REVIEW"
    ) as ChecklistReportRow["status"];
    return {
      id: i.id,
      title: i.title,
      status,
      rejectionReason: i.rejectionReason,
      location: locationFor(i.wbsNodeId),
      contractorName: i.wbsNode?.contractor?.name ?? null,
      filledByName: i.filledBy?.name ?? null,
      reviewedByName: i.reviewedBy?.name ?? null,
      createdAt: i.createdAt,
      reviewedAt: i.reviewedAt,
      itemsTotal,
      itemsPassed,
    };
  });

  const inReview = rows.filter((r) => r.status === "IN_REVIEW").length;
  const passed = rows.filter((r) => r.status === "PASSED").length;
  const rejected = rows.filter((r) => r.status === "REJECTED").length;
  const decided = passed + rejected;
  const successRate = decided === 0 ? 0 : Math.round((passed / decided) * 100);

  return {
    range: { from: fromIso, to: toIso },
    totals: { total: rows.length, inReview, passed, rejected, successRate },
    rows,
  };
}
