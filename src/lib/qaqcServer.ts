// Aggregations that power the QA/QC top tab.
//
// The tab mirrors the Colab QAQC screenshot Shraddha sent, with two additions
// I proposed:
//   §1 Work Inspection Request  — success rate + Total/Passed/Rejected/InReview
//   §2 Issues & Defects        — OBS vs NCS breakdown, %-closed, TAT
//   §3 Material Inspection Req — empty until we track it separately
//   §4 Defects by Category     — top categories with counts
//   §5 Latest Day Snapshot     — WIR/MIR/NCR count for today
//   §6 Last 7 Days trend       — daily counts per type
//   §7 Contractor Performance  — per-contractor WIR + Issues stats
//   §8 TAT trend               — my addition: rolling 30-day inspection TAT
//   §9 Recent photo feed       — my addition: last N inspection/issue photos

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Shape types
// ---------------------------------------------------------------------------

export interface InspectionCounts {
  total: number;
  passed: number;
  rejected: number;
  inReview: number;
  successRate: number | null; // passed / (passed + rejected), null if none
}

export interface DefectBucket {
  new: number;      // status OPEN, created in last 7 days
  inReview: number; // status OPEN, > 7 days old
  closed: number;   // status RESOLVED
  rejected: number; // status REJECTED (Issue model has no REJECTED today — reserved)
  total: number;
}

export interface IssuesSummary {
  total: number;
  closed: number;
  completedPct: number;
  submissionTATDays: number | null; // avg days from open → resolved
  approvalTATDays: number | null;   // reserved for a future review flow
  obs: DefectBucket;
  ncs: DefectBucket;
}

export interface DefectCategoryRow {
  category: string;
  count: number;
}

export interface LatestDaySnapshot {
  workInspections: number;
  materialInspections: number;
  nonConformanceReports: number;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TrendBundle {
  workInspection: TrendPoint[];
  materialInspection: TrendPoint[];
  nonConformance: TrendPoint[];
}

export interface ContractorRow {
  contractorId: string;
  contractorName: string;
  wir: { new: number; inReview: number; closed: number; tatDays: number | null };
  issues: { new: number; inReview: number; closed: number; tatDays: number | null };
}

export interface TATPoint {
  date: string;
  avgTatDays: number | null;
  count: number;
}

export interface RecentPhoto {
  url: string;
  source: "inspection" | "issue";
  parentId: string;
  parentLabel: string; // Inspection title OR issue description head
  loggedAt: string;
  loggedByName: string;
  contractorName: string | null;
}

export interface QaqcBundle {
  wir: InspectionCounts;
  issues: IssuesSummary;
  material: InspectionCounts; // placeholder — always zeros until material inspections modeled
  defectsByCategory: DefectCategoryRow[];
  latestDay: LatestDaySnapshot;
  last7Days: TrendBundle;
  contractors: ContractorRow[];
  tatTrend: TATPoint[]; // last 30 days
  recentPhotos: RecentPhoto[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}
function severityIsCritical(s: string | null | undefined): boolean {
  if (!s) return false;
  const norm = s.toUpperCase();
  return norm === "HIGH" || norm === "CRITICAL";
}
function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export async function getQaqcBundle(projectId: string, today: Date = new Date()): Promise<QaqcBundle> {
  const todayStart = toDay(today);
  const dayEnd = new Date(todayStart.getTime() + 86400000);
  const weekAgo = new Date(todayStart.getTime() - 7 * 86400000);
  const monthAgo = new Date(todayStart.getTime() - 30 * 86400000);

  const [inspections, issues, contractors] = await Promise.all([
    prisma.inspection.findMany({
      where: { projectId, deletedAt: null, module: "QAQC" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        wbsNode: { select: { contractorId: true } },
        filledBy: { select: { name: true } },
        photos: { select: { url: true }, take: 1 },
      },
    }),
    prisma.issue.findMany({
      where: { projectId, deletedAt: null, module: "QAQC" },
      select: {
        id: true,
        description: true,
        status: true,
        severity: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        wbsNode: { select: { contractorId: true } },
        createdBy: { select: { name: true } },
        photos: { select: { url: true }, take: 1 },
      },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // ------------- §1 Work Inspection Request -------------
  const wir: InspectionCounts = (() => {
    const total = inspections.length;
    let passed = 0, rejected = 0, inReview = 0;
    for (const i of inspections) {
      if (i.status === "APPROVED") passed++;
      else if (i.status === "REJECTED") rejected++;
      else inReview++;
    }
    const decided = passed + rejected;
    return {
      total,
      passed,
      rejected,
      inReview,
      successRate: decided > 0 ? Math.round((passed / decided) * 100) : null,
    };
  })();

  // ------------- §3 Material Inspection Request (placeholder) -------------
  const material: InspectionCounts = {
    total: 0, passed: 0, rejected: 0, inReview: 0, successRate: null,
  };

  // ------------- §2 Issues & Defects -------------
  const issuesSummary: IssuesSummary = (() => {
    const total = issues.length;
    let closed = 0;
    let closedDurationSum = 0;
    let closedDurationCount = 0;
    const obs: DefectBucket = { new: 0, inReview: 0, closed: 0, rejected: 0, total: 0 };
    const ncs: DefectBucket = { new: 0, inReview: 0, closed: 0, rejected: 0, total: 0 };

    for (const it of issues) {
      const bucket = severityIsCritical(it.severity) ? ncs : obs;
      bucket.total++;

      if (it.status === "RESOLVED" || it.status === "CLOSED") {
        closed++;
        bucket.closed++;
        const dur = daysBetween(it.createdAt, it.updatedAt);
        closedDurationSum += dur;
        closedDurationCount++;
      } else if (it.status === "REJECTED") {
        bucket.rejected++;
      } else {
        // OPEN
        const ageDays = daysBetween(it.createdAt, today);
        if (ageDays <= 7) bucket.new++;
        else bucket.inReview++;
      }
    }
    return {
      total,
      closed,
      completedPct: total > 0 ? Math.round((closed / total) * 100) : 0,
      submissionTATDays: closedDurationCount > 0 ? Math.round(closedDurationSum / closedDurationCount) : null,
      approvalTATDays: null,
      obs, ncs,
    };
  })();

  // ------------- §4 Defects by Category -------------
  const defectsByCategory: DefectCategoryRow[] = (() => {
    const byCat = new Map<string, number>();
    for (const it of issues) {
      const cat = it.category?.trim() || "Uncategorised";
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    }
    return [...byCat.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  })();

  // ------------- §5 Latest Day Snapshot -------------
  const latestDay: LatestDaySnapshot = {
    workInspections: inspections.filter((i) => i.createdAt >= todayStart && i.createdAt < dayEnd).length,
    materialInspections: 0,
    nonConformanceReports: issues.filter((i) => severityIsCritical(i.severity) && i.createdAt >= todayStart && i.createdAt < dayEnd).length,
  };

  // ------------- §6 Last 7 days trend -------------
  const last7Days: TrendBundle = (() => {
    const wirTrend: TrendPoint[] = [];
    const mirTrend: TrendPoint[] = [];
    const ncrTrend: TrendPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(todayStart.getTime() - i * 86400000);
      const dayEnd2 = new Date(dayStart.getTime() + 86400000);
      const key = fmtDay(dayStart);
      wirTrend.push({
        date: key,
        count: inspections.filter((x) => x.createdAt >= dayStart && x.createdAt < dayEnd2).length,
      });
      mirTrend.push({ date: key, count: 0 });
      ncrTrend.push({
        date: key,
        count: issues.filter((x) => severityIsCritical(x.severity) && x.createdAt >= dayStart && x.createdAt < dayEnd2).length,
      });
    }
    return { workInspection: wirTrend, materialInspection: mirTrend, nonConformance: ncrTrend };
  })();

  // ------------- §7 Contractor Performance Master -------------
  const contractorsOut: ContractorRow[] = contractors.map((c) => {
    const myInspections = inspections.filter((i) => i.wbsNode?.contractorId === c.id);
    const myIssues = issues.filter((i) => i.wbsNode?.contractorId === c.id);

    let iNew = 0, iIR = 0, iCl = 0, iTatSum = 0, iTatN = 0;
    for (const insp of myInspections) {
      if (insp.status === "APPROVED" || insp.status === "REJECTED") {
        iCl++;
        if (insp.reviewedAt) {
          iTatSum += daysBetween(insp.createdAt, insp.reviewedAt);
          iTatN++;
        }
      } else {
        const ageDays = daysBetween(insp.createdAt, today);
        if (ageDays <= 7) iNew++;
        else iIR++;
      }
    }

    let isNew = 0, isIR = 0, isCl = 0, isTatSum = 0, isTatN = 0;
    for (const iss of myIssues) {
      if (iss.status === "RESOLVED" || iss.status === "CLOSED") {
        isCl++;
        isTatSum += daysBetween(iss.createdAt, iss.updatedAt);
        isTatN++;
      } else {
        const ageDays = daysBetween(iss.createdAt, today);
        if (ageDays <= 7) isNew++;
        else isIR++;
      }
    }

    return {
      contractorId: c.id,
      contractorName: c.name,
      wir: {
        new: iNew, inReview: iIR, closed: iCl,
        tatDays: iTatN > 0 ? Math.round((iTatSum / iTatN) * 10) / 10 : null,
      },
      issues: {
        new: isNew, inReview: isIR, closed: isCl,
        tatDays: isTatN > 0 ? Math.round((isTatSum / isTatN) * 10) / 10 : null,
      },
    };
  });

  // ------------- §8 TAT trend (rolling 30 days) -------------
  const tatTrend: TATPoint[] = (() => {
    const closedInWindow = inspections.filter(
      (i) => i.reviewedAt && i.reviewedAt >= monthAgo && (i.status === "APPROVED" || i.status === "REJECTED"),
    );
    const points: TATPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(todayStart.getTime() - i * 86400000);
      const dayEnd2 = new Date(dayStart.getTime() + 86400000);
      const closedThisDay = closedInWindow.filter((x) => x.reviewedAt! >= dayStart && x.reviewedAt! < dayEnd2);
      const total = closedThisDay.reduce((n, x) => n + daysBetween(x.createdAt, x.reviewedAt!), 0);
      const avg = closedThisDay.length > 0 ? Math.round((total / closedThisDay.length) * 10) / 10 : null;
      points.push({ date: fmtDay(dayStart), avgTatDays: avg, count: closedThisDay.length });
    }
    return points;
  })();

  // ------------- §9 Recent Photo Feed -------------
  const recentPhotos: RecentPhoto[] = (() => {
    const photoRows: RecentPhoto[] = [];
    // Inspection photos (last 30 days)
    for (const i of inspections) {
      if (i.createdAt < monthAgo) continue;
      for (const p of i.photos) {
        photoRows.push({
          url: p.url,
          source: "inspection",
          parentId: i.id,
          parentLabel: i.title,
          loggedAt: i.createdAt.toISOString(),
          loggedByName: i.filledBy.name,
          contractorName: null,
        });
      }
    }
    // Issue photos (last 30 days)
    for (const it of issues) {
      if (it.createdAt < monthAgo) continue;
      for (const p of it.photos) {
        const head = it.description.length > 60 ? it.description.slice(0, 60) + "…" : it.description;
        photoRows.push({
          url: p.url,
          source: "issue",
          parentId: it.id,
          parentLabel: head,
          loggedAt: it.createdAt.toISOString(),
          loggedByName: it.createdBy.name,
          contractorName: null,
        });
      }
    }
    return photoRows
      .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
      .slice(0, 12);
  })();

  // Suppress unused variable warning
  void weekAgo;

  return {
    wir,
    issues: issuesSummary,
    material,
    defectsByCategory,
    latestDay,
    last7Days,
    contractors: contractorsOut,
    tatTrend,
    recentPhotos,
  };
}
