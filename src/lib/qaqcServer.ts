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
import { isQaqcTeamName, isTestUserName } from "@/lib/dashboardExclusions";

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

export interface IssueRow {
  id: string;
  description: string;
  status: string;
  severity: string | null;
  category: string | null;
  createdAt: string;
  createdByName: string;
  wbsName: string | null;
  contractorName: string | null;
}

export interface InspectionRow {
  id: string;
  title: string;
  status: string;
  module: string | null;
  createdAt: string;
  reviewedAt: string | null;
  filledByName: string;
  wbsName: string | null;
  contractorName: string | null;
}

export interface QaqcBundle {
  wir: InspectionCounts;
  issues: IssuesSummary;
  material: InspectionCounts; // placeholder - always zeros until material inspections modeled
  defectsByCategory: DefectCategoryRow[];
  latestDay: LatestDaySnapshot;
  last7Days: TrendBundle;
  contractors: ContractorRow[];
  tatTrend: TATPoint[]; // last 30 days
  recentPhotos: RecentPhoto[];
  /** Flat list of every QA/QC Issue (OBS + NCS, open + closed) so the
   *  Issues-&-Defects tile can click through to the actual rows below the
   *  summary. Sorted newest first. */
  issueRows: IssueRow[];
  /** Flat list of every Inspection record on the project (regardless of
   *  module - see the module-filter note in getQaqcBundle). Sorted newest
   *  first. Powers the "all inspections" expander below the WIR tile. */
  inspectionRows: InspectionRow[];
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

  // Vandana 2026-11-04 management-review pass (iteration 2):
  //   The Colab import landed every inspection as module="SAFETY" even
  //   though many are QA/QC checklists. Instead of counting every
  //   inspection on QA/QC (which double-counted with EHS), we now use the
  //   filler's identity to reclassify: inspections filled by Nagarjuna or
  //   Thangamani (the QA/QC team on Amanvana per memory:
  //   roles_by_module.md) count under QA/QC regardless of module tag.
  //   module="QAQC" rows always count here too.
  //   Rows filled by the test-user admin account (Vandana) are excluded
  //   from both counts and the row list so management doesn't see
  //   development-time noise.
  const [inspectionsRaw, issues, contractors] = await Promise.all([
    prisma.inspection.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        module: true,
        createdAt: true,
        reviewedAt: true,
        wbsNode: { select: { contractorId: true, name: true } },
        // Fallback contractor signal for inspections imported without a
        // WBS attachment (all Colab-imported inspections on Amanvana
        // hit this path). Set User.contractorId in Admin > Users.
        filledBy: { select: { name: true, contractorId: true } },
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
        wbsNode: { select: { contractorId: true, name: true } },
        createdBy: { select: { name: true, contractorId: true } },
        photos: { select: { url: true }, take: 1 },
      },
    }),
    // Filter to visible-only contractors - the Contractor Performance table
    // only needs to show Abraham + Elegant (the two execution contractors
    // showInPickers). The hidden ones were showing as zero-row noise.
    prisma.contractor.findMany({
      where: { projectId, active: true, showInPickers: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Apply the dashboard exclusions: drop test-user rows entirely, then keep
  // only inspections that are QA/QC in intent - either tagged QAQC or
  // filled by the QA/QC team.
  const inspections = inspectionsRaw
    .filter((i) => !isTestUserName(i.filledBy?.name))
    .filter((i) => i.module === "QAQC" || isQaqcTeamName(i.filledBy?.name));

  // ------------- §1 Work Inspection Request -------------
  const wir: InspectionCounts = (() => {
    const total = inspections.length;
    let passed = 0, rejected = 0, inReview = 0;
    for (const i of inspections) {
      if (i.status === "PASSED") passed++;
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
  // Attribution: WBS-tag wins, then fall back to User.contractorId on the
  // person who filled the inspection / raised the issue. Colab imports
  // land with no WBS tie, so User.contractorId is the practical signal —
  // rows stay blank for any inspection whose filler doesn't have a
  // contractor set (visible via the "Unassigned" bucket downstream).
  const contractorOf = (i: { wbsNode: { contractorId: string | null } | null; filledBy: { contractorId: string | null } }) =>
    i.wbsNode?.contractorId ?? i.filledBy?.contractorId ?? null;
  const issueContractorOf = (i: { wbsNode: { contractorId: string | null } | null; createdBy: { contractorId: string | null } }) =>
    i.wbsNode?.contractorId ?? i.createdBy?.contractorId ?? null;
  const contractorsOut: ContractorRow[] = contractors.map((c) => {
    const myInspections = inspections.filter((i) => contractorOf(i) === c.id);
    const myIssues = issues.filter((i) => issueContractorOf(i) === c.id);

    let iNew = 0, iIR = 0, iCl = 0, iTatSum = 0, iTatN = 0;
    for (const insp of myInspections) {
      if (insp.status === "PASSED" || insp.status === "REJECTED") {
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
      (i) => i.reviewedAt && i.reviewedAt >= monthAgo && (i.status === "PASSED" || i.status === "REJECTED"),
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
  // Vandana 2026-11-05: drop the 30-day window - show whatever photos
  // exist, newest first. An empty "no photos in the last 30 days" message
  // when there ARE older photos is misleading.
  const recentPhotos: RecentPhoto[] = (() => {
    const photoRows: RecentPhoto[] = [];
    for (const i of inspections) {
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
    for (const it of issues) {
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

  // Flat row lists for the click-through sections below the summary tiles.
  const contractorNameById = new Map(contractors.map((c) => [c.id, c.name]));
  const issueRows: IssueRow[] = issues
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((it) => {
      const cid = it.wbsNode?.contractorId ?? it.createdBy?.contractorId ?? null;
      return {
        id: it.id,
        description: it.description,
        status: it.status,
        severity: it.severity ?? null,
        category: it.category ?? null,
        createdAt: it.createdAt.toISOString(),
        createdByName: it.createdBy?.name ?? "Unknown",
        wbsName: it.wbsNode?.name ?? null,
        contractorName: cid ? contractorNameById.get(cid) ?? null : null,
      };
    });
  const inspectionRows: InspectionRow[] = inspections
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((i) => {
      const cid = i.wbsNode?.contractorId ?? i.filledBy?.contractorId ?? null;
      return {
        id: i.id,
        title: i.title,
        status: i.status,
        module: i.module ?? null,
        createdAt: i.createdAt.toISOString(),
        reviewedAt: i.reviewedAt?.toISOString() ?? null,
        filledByName: i.filledBy?.name ?? "Unknown",
        wbsName: i.wbsNode?.name ?? null,
        contractorName: cid ? contractorNameById.get(cid) ?? null : null,
      };
    });

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
    issueRows,
    inspectionRows,
  };
}
