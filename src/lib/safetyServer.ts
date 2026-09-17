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
  safeManHours: number;         // sum of ManpowerEntry.actualCount * 8 since last LTI (or project start)
  ltiFreeDays: number;          // days since last LTI incident (or project start if never)
  daysSinceLastIncident: number; // days since ANY safety issue (my addition)
  lastIncidentDate: string | null;
  lastLtiDate: string | null;
  safeSincePreset: string;      // human label like "since project start" or "since 12 Aug"
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

export interface SafetyBundle {
  overview: SafetyOverview;
  categories: IncidentCategoryRow[];
  compliance: SafetyComplianceRow[];
  inductions: SafetyInductionSummary; // placeholder counts — 0 until induction model added
  permits: SafetyPermitSummary;
  submissionsLast7Days: InductionSubmissionsPoint[];  // placeholder
  submissionsLast4Weeks: InductionSubmissionsPoint[]; // placeholder
  submissionsLast6Months: InductionSubmissionsPoint[]; // placeholder
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

  const [project, allSafetyIssues, safetyInspections, contractors, manpower, permits] = await Promise.all([
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
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.inspection.findMany({
      where: { projectId, deletedAt: null, module: "SAFETY" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        wbsNode: { select: { contractorId: true } },
      },
    }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
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
  ]);

  // ------- §1 Safety Overview -------
  const projectStart = project?.actualStartDate ?? project?.startDate ?? todayStart;
  const lastIncident = allSafetyIssues[0];
  const lastLti = allSafetyIssues.find((i) => (i.category ?? "").toUpperCase() === "LTI");

  const ltiCutoff = lastLti?.createdAt ?? projectStart;
  const manHours = manpower
    .filter((m) => m.entryDate >= ltiCutoff)
    .reduce((sum, m) => sum + m.actualCount * 8, 0);

  const overview: SafetyOverview = {
    safeManHours: manHours,
    ltiFreeDays: daysBetween(lastLti?.createdAt ?? projectStart, today),
    daysSinceLastIncident: daysBetween(lastIncident?.createdAt ?? projectStart, today),
    lastIncidentDate: lastIncident?.createdAt.toISOString() ?? null,
    lastLtiDate: lastLti?.createdAt.toISOString() ?? null,
    safeSincePreset: lastLti
      ? `since ${lastLti.createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
      : "since project start",
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
  const compliance: SafetyComplianceRow[] = contractors.map((c) => {
    const myInspections = safetyInspections.filter((i) => i.wbsNode?.contractorId === c.id);
    const myIssues = allSafetyIssues.filter((i) => i.wbsNode?.contractorId === c.id);
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

  // ------- §4 Inductions (placeholder — no model yet) -------
  const inductions: SafetyInductionSummary = {
    totalSubmitted: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    perContractor: contractors.map((c) => ({
      contractorId: c.id,
      contractorName: c.name,
      approvedPct: null,
    })),
  };

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

  return {
    overview,
    categories,
    compliance,
    inductions,
    permits: permitsOut,
    submissionsLast7Days: emptyTrend(7),
    submissionsLast4Weeks: emptyTrend(28),
    submissionsLast6Months: emptyTrend(180),
  };
}
