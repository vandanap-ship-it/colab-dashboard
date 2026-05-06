import { prisma } from "@/lib/prisma";

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
 */
export async function getMasterReport(
  projectId: string,
  _fromIso: string,
  _toIso: string,
  today = new Date(),
): Promise<MasterReportData> {
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
      delayReason: true,
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

  function plannedPercentFor(
    n: { baselineStart: Date | null; baselineFinish: Date | null },
    asOf = today,
  ): number {
    if (!n.baselineStart || !n.baselineFinish) return 0;
    const start = n.baselineStart.getTime();
    const end = n.baselineFinish.getTime();
    const now = asOf.getTime();
    if (now <= start) return 0;
    if (now >= end) return 100;
    return ((now - start) / (end - start)) * 100;
  }

  // ---- Overall ----
  const projectStart = project?.startDate ?? null;
  const projectEnd = project?.endDate ?? null;
  const reraEnd = project?.reraEndDate ?? null;

  const earliestActual = leaves
    .map((l) => l.actualStart)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const latestProjected = leaves
    .map((l) => l.projectedFinish ?? l.actualFinish)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const plannedSum = leaves.reduce((s, l) => s + plannedPercentFor(l), 0);
  const achievedSum = leaves.reduce((s, l) => s + (l.percentComplete ?? 0), 0);
  const overallPlanned = leaves.length === 0 ? 0 : plannedSum / leaves.length;
  const overallAchieved = leaves.length === 0 ? 0 : achievedSum / leaves.length;

  const totalDelayDays =
    projectEnd && latestProjected ? Math.max(0, diffDays(latestProjected, projectEnd) ?? 0) : 0;
  const reraDelayDays =
    reraEnd && latestProjected ? Math.max(0, diffDays(latestProjected, reraEnd) ?? 0) : 0;

  const hindrancesOpen = await prisma.hindrance.count({
    where: { projectId, status: "OPEN" },
  });

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

    const phaseTotalDelay =
      phase.baselineFinish && phaseProjected
        ? Math.max(0, diffDays(phaseProjected, phase.baselineFinish) ?? 0)
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

  // ---- Total activities (all leaves, with location breadcrumb) ----
  const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
  const parentByIdMap = new Map(allNodes.map((n) => [n.id, n.parentId]));
  function locationFor(leafId: string): string {
    const parts: string[] = [];
    let cur = parentByIdMap.get(leafId) ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      const name = nameById.get(cur);
      // Skip the project root (depth 0 from root)
      const node = allNodes.find((n) => n.id === cur);
      if (node && node.level >= 1 && name) parts.push(name);
      cur = parentByIdMap.get(cur) ?? null;
      depth += 1;
    }
    return parts.reverse().join(" / ") || "—";
  }

  const totalActivities: MasterReportData["totalActivities"] = leaves
    .map((l) => ({
      id: l.id,
      name: l.name,
      location: locationFor(l.id),
      plannedPercent: Math.round(plannedPercentFor(l) * 100) / 100,
      actualPercent: Math.round((l.percentComplete ?? 0) * 100) / 100,
      delayReason: l.delayReason,
      plannedStart: l.baselineStart,
      plannedEnd: l.baselineFinish,
      projectedEnd: l.projectedFinish ?? l.actualFinish,
    }))
    .sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));

  return { overall, perZone, totalActivities };
}

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
      location: i.wbsNode ? locationFor(i.wbsNode.parentId ? i.id : i.id) : "—",
      contractorName: i.wbsNode?.contractor?.name ?? null,
      filledByName: i.filledBy?.name ?? null,
      reviewedByName: i.reviewedBy?.name ?? null,
      createdAt: i.createdAt,
      reviewedAt: i.reviewedAt,
      itemsTotal,
      itemsPassed,
    };
  });

  // Better location: rebuild from wbsNodeId (need node id, not item id)
  const inspNodeIds = inspections.map((i) => i.wbsNodeId).filter(Boolean) as string[];
  if (inspNodeIds.length > 0) {
    const idMap = new Map(inspections.map((i) => [i.id, i.wbsNodeId]));
    for (const r of rows) {
      const nodeId = idMap.get(r.id);
      if (nodeId) r.location = locationFor(nodeId);
      else r.location = "—";
    }
  } else {
    for (const r of rows) r.location = "—";
  }

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
