// Aggregations for the Safety (EHS) top tab. Colab structure + my additions:
//   §1 Safety Overview      — Safe Man-Hours + LTI-Free Days + Days-since
//   §2 Incident Categories  — counts per canonical safety category
//   §3 Compliance Matrix    — per-contractor: inspections + issues
//   §4 Safety Details       — inductions status
//   §5 Active Permits       — safety-relevant permits summary
//   §6 Labour Induction Submissions — 7/Weekly/Monthly buckets (placeholder)

import { prisma } from "@/lib/prisma";
import { SAFETY_CATEGORIES } from "@/lib/safetyCategories";

// ---------------------------------------------------------------------------
// Shape types
// ---------------------------------------------------------------------------

export interface SafetyOverview {
  /** Sum of ManpowerEntry.actualCount * 8 across the project to date. The
   *  only "overview" metric the dashboard surfaces - the old
   *  "days since last incident" and "LTI-free days" tiles were removed on
   *  2026-11-04 (Vandana management-review pass). */
  safeManHours: number;
  /** Human label for the window - e.g. "since project start" or "since Aug 12". */
  safeSincePreset: string;
  /** Project-wide activity counts the dashboard surfaces as big tiles. */
  totalInductions: number;
  inductionsApproved: number;
  inductionsPending: number;
  inductionsRejected: number;
  totalHseChecklists: number;      // Inspection rows tagged SAFETY
  hseChecklistsPassed: number;
  hseChecklistsPending: number;    // in draft / review / conditionally approved
  totalSafetyPermits: number;
  permitsApproved: number;
  permitsPending: number;
  permitsClosedOrRejected: number;
  totalSafetyObservations: number;
}

export interface IncidentCategoryRow {
  code: string;
  label: string;
  count: number;
}

export interface SafetyComplianceRow {
  contractorId: string;
  contractorName: string;
  inspections: { total: number; closed: number; inReview: number; obs: number; ncr: number; avgTatDays: number | null };
}

export interface SafetyInductionSummary {
  totalSubmitted: number;
  approved: number;
  pending: number;
  rejected: number;
  // Compliance % per contractor (approved / (approved + pending)) — my addition.
  perContractor: Array<{ contractorId: string; contractorName: string; approvedPct: number | null }>;
}

export interface SafetyPermitSummary {
  active: number;
  expiringSoon: number;
  expired: number;
  totalActive: number; // active + expiringSoon
  permits: Array<{
    id: string;
    name: string;
    number: string | null;
    category: string;
    expiryDate: string | null;
    status: string;
  }>;
}

export interface InductionSubmissionsPoint {
  date: string;
  count: number;
}

// Row lists for click-through sections (added 2026-11-04 management review).
export interface SafetyInductionRow {
  id: string;
  displayId: string;
  workerName: string;
  trade: string;
  status: string;
  inductionDate: string;
  expiryDate: string;
  contractorName: string | null;
}
export interface HseChecklistRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  filledByName: string;
  wbsName: string | null;
  contractorName: string | null;
}
export interface SafetyPermitRow {
  id: string;
  title: string;
  type: string;
  workDate: string;
  status: string;
}
export interface SafetyObservationRow {
  id: string;
  category: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  contractorName: string | null;
}

export interface SafetyBundle {
  overview: SafetyOverview;
  categories: IncidentCategoryRow[];
  compliance: SafetyComplianceRow[];
  inductions: SafetyInductionSummary;
  permits: SafetyPermitSummary;
  submissionsLast7Days: InductionSubmissionsPoint[];  // placeholder
  submissionsLast4Weeks: InductionSubmissionsPoint[]; // placeholder
  submissionsLast6Months: InductionSubmissionsPoint[]; // placeholder
  inductionRows: SafetyInductionRow[];
  hseChecklistRows: HseChecklistRow[];
  permitRows: SafetyPermitRow[];
  observationRows: SafetyObservationRow[];
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
function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export async function getSafetyBundle(projectId: string, today: Date = new Date()): Promise<SafetyBundle> {
  const todayStart = toDay(today);

  const [project, allSafetyIssues, safetyInspections, contractors, manpower, permits, inductions] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { startDate: true, actualStartDate: true },
    }),
    prisma.issue.findMany({
      where: { projectId, deletedAt: null, module: "SAFETY" },
      select: {
        id: true,
        category: true,
        severity: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        wbsNode: { select: { contractorId: true } },
        // Fallback contractor signal - see qaqcServer for the same
        // treatment. Colab-imported rows have no WBS attachment.
        createdBy: { select: { contractorId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.inspection.findMany({
      where: { projectId, deletedAt: null, module: "SAFETY" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        wbsNode: { select: { contractorId: true, name: true } },
        filledBy: { select: { name: true, contractorId: true } },
      },
    }),
    prisma.contractor.findMany({
      // showInPickers = the two execution contractors (Abraham + Elegant).
      // Hidden contractors used to appear as empty-row noise on the matrix;
      // trimmed on 2026-11-04 per Vandana's management-review feedback.
      where: { projectId, active: true, showInPickers: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.manpowerEntry.findMany({
      where: { projectId, deletedAt: null },
      select: { actualCount: true, entryDate: true },
    }),
    // §5 sources from WorkPermit — the daily hazard-controlled site permits
    // (Hot Work, Night Work, De-shuttering) that a safety officer actually
    // watches on a live project. The old code queried `Permit` with
    // category="SAFETY", which is the compliance-permit model (fire safety
    // cert, elevator cert, etc.). Amanvana has none of those in the pilot,
    // so the tile always read 0 despite 100+ safety-relevant work permits
    // sitting in the system.
    //
    // GENERAL work permits are excluded — they're routine work and don't
    // carry safety controls.
    prisma.workPermit.findMany({
      where: {
        projectId,
        deletedAt: null,
        type: { in: ["HOT_WORK", "NIGHT_WORK", "DESHUTTERING"] },
      },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        type: true,
        workDate: true,
        status: true,
      },
    }),
    prisma.safetyInduction.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { inductionDate: "desc" },
      select: {
        id: true,
        displayId: true,
        workerName: true,
        trade: true,
        contractorId: true,
        status: true,
        inductionDate: true,
        expiryDate: true,
      },
    }),
  ]);

  // ------- §1 Safety Overview -------
  // The old tiles "Days since last incident" + "LTI-free days" were removed
  // on 2026-11-04 (Vandana management-review pass). The overview tile grid
  // now surfaces the real activity volumes the dashboard needs: inductions
  // / HSE checklists / safety permits / observations.
  const projectStart = project?.actualStartDate ?? project?.startDate ?? todayStart;
  const manHours = manpower.reduce((sum, m) => sum + m.actualCount * 8, 0);

  const inductionsApproved = inductions.filter((i) => i.status === "APPROVED").length;
  const inductionsPending = inductions.filter((i) => i.status === "PENDING").length;
  const inductionsRejected = inductions.filter((i) => i.status === "REJECTED").length;
  const hseChecklistsPassed = safetyInspections.filter((i) => i.status === "PASSED").length;
  const hseChecklistsPending = safetyInspections.filter(
    (i) => i.status !== "PASSED" && i.status !== "REJECTED",
  ).length;
  const permitsApproved = permits.filter((p) => p.status === "APPROVED").length;
  const permitsPending = permits.filter((p) => p.status === "PENDING").length;
  const permitsClosedOrRejected = permits.filter(
    (p) => p.status === "CLOSED" || p.status === "REJECTED",
  ).length;

  const overview: SafetyOverview = {
    safeManHours: manHours,
    safeSincePreset: `since ${projectStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
    totalInductions: inductions.length,
    inductionsApproved,
    inductionsPending,
    inductionsRejected,
    totalHseChecklists: safetyInspections.length,
    hseChecklistsPassed,
    hseChecklistsPending,
    totalSafetyPermits: permits.length,
    permitsApproved,
    permitsPending,
    permitsClosedOrRejected,
    totalSafetyObservations: allSafetyIssues.length,
  };

  // ------- §2 Incident Categories -------
  const counts = new Map<string, number>();
  for (const it of allSafetyIssues) {
    const key = (it.category ?? "OTHER").toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const categories: IncidentCategoryRow[] = SAFETY_CATEGORIES.map((c) => ({
    code: c.code,
    label: c.label,
    count: counts.get(c.code) ?? 0,
  }));

  // ------- §3 Compliance Matrix -------
  // Attribution fallback — same treatment as qaqcServer. Colab-imported
  // inspections come in without a WBS attachment, so User.contractorId on
  // the filler / creator is the practical signal.
  const inspContractorOf = (i: { wbsNode: { contractorId: string | null } | null; filledBy: { contractorId: string | null } }) =>
    i.wbsNode?.contractorId ?? i.filledBy?.contractorId ?? null;
  const issueContractorOf = (i: { wbsNode: { contractorId: string | null } | null; createdBy: { contractorId: string | null } }) =>
    i.wbsNode?.contractorId ?? i.createdBy?.contractorId ?? null;
  const compliance: SafetyComplianceRow[] = contractors.map((c) => {
    const myInspections = safetyInspections.filter((i) => inspContractorOf(i) === c.id);
    const myIssues = allSafetyIssues.filter((i) => issueContractorOf(i) === c.id);
    let closed = 0, inReview = 0, tatSum = 0, tatN = 0;
    for (const insp of myInspections) {
      if (insp.status === "PASSED" || insp.status === "REJECTED") {
        closed++;
        if (insp.reviewedAt) {
          tatSum += daysBetween(insp.createdAt, insp.reviewedAt);
          tatN++;
        }
      } else inReview++;
    }
    // OBS = LOW/MEDIUM severity or null; NCR = HIGH/CRITICAL
    let obs = 0, ncr = 0;
    for (const iss of myIssues) {
      const sev = (iss.severity ?? "").toUpperCase();
      if (sev === "HIGH" || sev === "CRITICAL") ncr++;
      else obs++;
    }
    return {
      contractorId: c.id,
      contractorName: c.name,
      inspections: {
        total: myInspections.length,
        closed,
        inReview,
        obs,
        ncr,
        avgTatDays: tatN > 0 ? Math.round((tatSum / tatN) * 10) / 10 : null,
      },
    };
  });

  // ------- §4 Inductions (now wired to the SafetyInduction model) -------
  const inductionsSummary: SafetyInductionSummary = (() => {
    const totalSubmitted = inductions.length;
    const approved = inductionsApproved;
    const pending = inductionsPending;
    const rejected = inductionsRejected;
    const perContractor = contractors.map((c) => {
      const mine = inductions.filter((i) => i.contractorId === c.id);
      const mineApproved = mine.filter((i) => i.status === "APPROVED").length;
      const minePending = mine.filter((i) => i.status === "PENDING").length;
      const denom = mineApproved + minePending;
      return {
        contractorId: c.id,
        contractorName: c.name,
        approvedPct: denom > 0 ? Math.round((mineApproved / denom) * 100) : null,
      };
    });
    return { totalSubmitted, approved, pending, rejected, perContractor };
  })();

  // ------- §5 Active Permits -------
  // Map WorkPermit statuses onto the SafetyPermitSummary shape. Fields kept
  // the same for downstream compatibility but semantics shift to what makes
  // sense for daily hazard permits:
  //   active         = APPROVED — currently allowed to work
  //   expiringSoon   = PENDING  — needs an approver's attention
  //   expired        = REJECTED + CLOSED — off the board
  //   totalActive    = APPROVED + PENDING (things still in flight)
  //
  // The "expiryDate" column becomes workDate (the day the permit is
  // authorized for) so the list still reads sensibly.
  const active = permits.filter((p) => p.status === "APPROVED").length;
  const pending = permits.filter((p) => p.status === "PENDING").length;
  const rejectedOrClosed = permits.filter((p) => p.status === "REJECTED" || p.status === "CLOSED").length;
  const permitsOut: SafetyPermitSummary = {
    active,
    expiringSoon: pending,
    expired: rejectedOrClosed,
    totalActive: active + pending,
    // Front-load PENDING (need attention) then APPROVED, then others.
    permits: [...permits]
      .sort((a, b) => {
        const rank = (s: string) => (s === "PENDING" ? 0 : s === "APPROVED" ? 1 : 2);
        const rd = rank(a.status) - rank(b.status);
        if (rd !== 0) return rd;
        return b.workDate.getTime() - a.workDate.getTime();
      })
      .map((p) => ({
        id: p.id,
        name: p.title,
        number: null,
        category: p.type,
        expiryDate: p.workDate.toISOString(),
        status: p.status,
      })),
  };

  // ------- §6 Submissions trend (placeholder) -------
  const emptyTrend = (days: number): InductionSubmissionsPoint[] => {
    const points: InductionSubmissionsPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      points.push({ date: fmtDay(new Date(todayStart.getTime() - i * 86400000)), count: 0 });
    }
    return points;
  };

  // Row lists for click-through sections.
  const contractorNameById = new Map(contractors.map((c) => [c.id, c.name]));
  const inductionRows: SafetyInductionRow[] = inductions.map((i) => ({
    id: i.id,
    displayId: i.displayId,
    workerName: i.workerName,
    trade: i.trade,
    status: i.status,
    inductionDate: i.inductionDate.toISOString(),
    expiryDate: i.expiryDate.toISOString(),
    contractorName: i.contractorId ? contractorNameById.get(i.contractorId) ?? null : null,
  }));
  const hseChecklistRows: HseChecklistRow[] = safetyInspections.map((i) => {
    const cid = i.wbsNode?.contractorId ?? i.filledBy?.contractorId ?? null;
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
      reviewedAt: i.reviewedAt?.toISOString() ?? null,
      filledByName: i.filledBy?.name ?? "Unknown",
      wbsName: i.wbsNode?.name ?? null,
      contractorName: cid ? contractorNameById.get(cid) ?? null : null,
    };
  });
  const permitRows: SafetyPermitRow[] = permits.map((p) => ({
    id: p.id,
    title: p.title,
    type: p.type,
    workDate: p.workDate.toISOString(),
    status: p.status,
  }));
  const observationRows: SafetyObservationRow[] = allSafetyIssues.map((it) => ({
    id: it.id,
    category: it.category ?? null,
    severity: it.severity ?? null,
    status: it.status,
    createdAt: it.createdAt.toISOString(),
    contractorName: it.wbsNode?.contractorId
      ? contractorNameById.get(it.wbsNode.contractorId) ?? null
      : it.createdBy?.contractorId
        ? contractorNameById.get(it.createdBy.contractorId) ?? null
        : null,
  }));

  return {
    overview,
    categories,
    compliance,
    inductions: inductionsSummary,
    permits: permitsOut,
    submissionsLast7Days: emptyTrend(7),
    submissionsLast4Weeks: emptyTrend(28),
    submissionsLast6Months: emptyTrend(180),
    inductionRows,
    hseChecklistRows,
    permitRows,
    observationRows,
  };
}
