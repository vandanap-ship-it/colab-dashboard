// ---------------------------------------------------------------------------
// Contractor scorecard — one query pass, one shape.
//
// Aggregates quality (WIR pass/reject), snag hygiene (open/resolved/high) and
// schedule performance (activities completed vs baseline, activities currently
// overdue, avg delay days on completed activities) per contractor.
//
// Attribution:
//   - Default: WBSNode.contractorId (what the CSV import tags).
//   - Amanvana override: fall back to the villa-based block registry when a
//     wbsNode has no contractor tag. That matches the same rule
//     weeklyReportServer.ts already uses in §02 Contractor Movement, so the
//     scorecard numbers stay consistent with the weekly report leadership
//     already sees.
//
// Lifetime numbers — no date range. This is the "how is contractor X doing
// on this project overall" view. Leadership uses this for the weekly review;
// a range-filtered version can come later if it turns out to be useful.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import {
  AMANVANA_CONTRACTORS,
  AMANVANA_VILLA_NUMBER_TO_BLOCK,
  AMANVANA_CONTRACTOR_SCOPE,
} from "@/lib/projects/amanvana";

export interface ContractorScorecardRow {
  contractorId: string | null;
  contractorName: string;
  villaCount: number;
  inspections: {
    total: number;
    passed: number;
    rejected: number;
    inReview: number;
    /** PASSED / (PASSED + REJECTED). `null` if no reviewed inspections yet. */
    passRate: number | null;
  };
  snags: {
    open: number;
    resolved: number;
    inReinspection: number;
    /** OPEN snags at HIGH severity — the ones leadership actually cares about. */
    highOpen: number;
    /** Median days to move an OPEN → RESOLVED. Null if no resolved snags yet. */
    medianResolutionDays: number | null;
  };
  progress: {
    activitiesCompleted: number;
    /** actualFinish IS null AND baselineFinish < today. */
    activitiesOverdue: number;
    /** Mean (actualFinish - baselineFinish) in days for completed activities.
     *  Positive = late on average; negative = ahead. Null if no completed
     *  activities that had a baseline. */
    avgDelayDaysCompleted: number | null;
  };
}

export interface ContractorScorecard {
  projectId: string;
  projectName: string;
  asOf: Date;
  rows: ContractorScorecardRow[];
}

/**
 * Resolve which contractor "owns" a given wbsNode.
 *
 * Preference order:
 *   1. wbsNode.contractorId (direct tag)
 *   2. Amanvana villa override — if the villaId maps back to a numbered villa
 *      that's in Abraham's registry, attribute to Abraham; otherwise attribute
 *      to Elegant (Amanvana Phase 1 has exactly two contractors, so any villa
 *      not in Abraham's block set is Elegant's by construction).
 *   3. Give up — return null. The scorecard row won't include this wbsNode.
 */
function attributeContractor(
  wbsNode: { contractorId: string | null; villaId: string | null },
  villaNumberById: Map<string, number>,
  contractorIdByName: Map<string, string>,
): string | null {
  if (wbsNode.contractorId) return wbsNode.contractorId;
  if (!wbsNode.villaId) return null;
  const villaNum = villaNumberById.get(wbsNode.villaId);
  if (villaNum == null) return null;
  const inAbrahamRegistry = AMANVANA_VILLA_NUMBER_TO_BLOCK[villaNum] !== undefined;
  const target = inAbrahamRegistry
    ? AMANVANA_CONTRACTORS.abraham
    : AMANVANA_CONTRACTORS.elegant;
  return contractorIdByName.get(target.toLowerCase()) ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

export async function getContractorScorecard(projectId: string): Promise<ContractorScorecard | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return null;

  const asOf = new Date();

  // Pull the contractors, villas (for the number map), and every wbsNode we
  // need to attribute — all in one shot. Amanvana has ~17k wbsNodes; selecting
  // only the fields we need keeps this cheap.
  const [contractors, villas, wbsNodes] = await Promise.all([
    prisma.contractor.findMany({
      where: { projectId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.villa.findMany({
      where: { projectId },
      select: { id: true, number: true },
    }),
    prisma.wBSNode.findMany({
      where: { projectId },
      select: {
        id: true,
        contractorId: true,
        villaId: true,
        baselineFinish: true,
        actualFinish: true,
      },
    }),
  ]);

  const villaNumberById = new Map<string, number>();
  for (const v of villas) villaNumberById.set(v.id, v.number);

  const contractorIdByName = new Map<string, string>();
  for (const c of contractors) contractorIdByName.set(c.name.trim().toLowerCase(), c.id);

  // Attribute every wbsNode. Store the assignment so we don't re-derive it in
  // the aggregation passes.
  const contractorForNode = new Map<string, string | null>();
  const nodesByContractor = new Map<string, string[]>();
  const villasByContractor = new Map<string, Set<string>>();
  for (const n of wbsNodes) {
    const cid = attributeContractor(n, villaNumberById, contractorIdByName);
    contractorForNode.set(n.id, cid);
    if (!cid) continue;
    const arr = nodesByContractor.get(cid) ?? [];
    arr.push(n.id);
    nodesByContractor.set(cid, arr);
    if (n.villaId) {
      const s = villasByContractor.get(cid) ?? new Set();
      s.add(n.villaId);
      villasByContractor.set(cid, s);
    }
  }

  // Progress metrics computed inline from the wbsNodes we already have.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const progressByContractor = new Map<
    string,
    { completed: number; overdue: number; delaySumDays: number; delayCount: number }
  >();
  for (const n of wbsNodes) {
    const cid = contractorForNode.get(n.id);
    if (!cid) continue;
    const bucket = progressByContractor.get(cid) ?? {
      completed: 0,
      overdue: 0,
      delaySumDays: 0,
      delayCount: 0,
    };
    if (n.actualFinish) {
      bucket.completed += 1;
      if (n.baselineFinish) {
        bucket.delaySumDays += daysBetween(n.actualFinish, n.baselineFinish);
        bucket.delayCount += 1;
      }
    } else if (n.baselineFinish && n.baselineFinish < today) {
      bucket.overdue += 1;
    }
    progressByContractor.set(cid, bucket);
  }

  // Inspections tied to a contractor via its wbsNodes.
  const inspections = await prisma.inspection.findMany({
    where: { projectId, deletedAt: null, wbsNodeId: { not: null } },
    select: { status: true, wbsNodeId: true },
  });
  const inspAgg = new Map<
    string,
    { total: number; passed: number; rejected: number; inReview: number }
  >();
  for (const i of inspections) {
    const cid = i.wbsNodeId ? contractorForNode.get(i.wbsNodeId) : null;
    if (!cid) continue;
    const bucket = inspAgg.get(cid) ?? { total: 0, passed: 0, rejected: 0, inReview: 0 };
    bucket.total += 1;
    if (i.status === "PASSED") bucket.passed += 1;
    else if (i.status === "REJECTED") bucket.rejected += 1;
    else if (i.status === "IN_REVIEW") bucket.inReview += 1;
    inspAgg.set(cid, bucket);
  }

  // Snags tied to a contractor via its wbsNodes. Median resolution collected
  // from the audit log would be more accurate; using updatedAt as a proxy
  // (RESOLVED status flip stamps updatedAt).
  const issues = await prisma.issue.findMany({
    where: { projectId, deletedAt: null, wbsNodeId: { not: null } },
    select: { status: true, severity: true, wbsNodeId: true, createdAt: true, updatedAt: true },
  });
  const issueAgg = new Map<
    string,
    {
      open: number;
      resolved: number;
      inReinspection: number;
      highOpen: number;
      resolutionDays: number[];
    }
  >();
  for (const i of issues) {
    const cid = i.wbsNodeId ? contractorForNode.get(i.wbsNodeId) : null;
    if (!cid) continue;
    const bucket = issueAgg.get(cid) ?? {
      open: 0,
      resolved: 0,
      inReinspection: 0,
      highOpen: 0,
      resolutionDays: [],
    };
    if (i.status === "OPEN") {
      bucket.open += 1;
      if (i.severity === "HIGH") bucket.highOpen += 1;
    } else if (i.status === "RESOLVED") {
      bucket.resolved += 1;
      bucket.resolutionDays.push(daysBetween(i.updatedAt, i.createdAt));
    } else if (i.status === "IN_REINSPECTION") {
      bucket.inReinspection += 1;
    }
    issueAgg.set(cid, bucket);
  }

  // Build the rows. Amanvana's villa scope override wins for the villaCount
  // when it exists so leadership sees 41 / 52 (the awarded contract counts),
  // not whatever the DB happens to have tagged.
  const rows: ContractorScorecardRow[] = contractors.map((c) => {
    const insp = inspAgg.get(c.id) ?? { total: 0, passed: 0, rejected: 0, inReview: 0 };
    const iss = issueAgg.get(c.id) ?? {
      open: 0,
      resolved: 0,
      inReinspection: 0,
      highOpen: 0,
      resolutionDays: [],
    };
    const prog = progressByContractor.get(c.id) ?? {
      completed: 0,
      overdue: 0,
      delaySumDays: 0,
      delayCount: 0,
    };
    const villaTagged = villasByContractor.get(c.id)?.size ?? 0;
    const scopeOverride = AMANVANA_CONTRACTOR_SCOPE[c.name.trim().toLowerCase()];
    const villaCount = scopeOverride ?? villaTagged;
    const reviewed = insp.passed + insp.rejected;
    return {
      contractorId: c.id,
      contractorName: c.name,
      villaCount,
      inspections: {
        total: insp.total,
        passed: insp.passed,
        rejected: insp.rejected,
        inReview: insp.inReview,
        passRate: reviewed > 0 ? insp.passed / reviewed : null,
      },
      snags: {
        open: iss.open,
        resolved: iss.resolved,
        inReinspection: iss.inReinspection,
        highOpen: iss.highOpen,
        medianResolutionDays: median(iss.resolutionDays),
      },
      progress: {
        activitiesCompleted: prog.completed,
        activitiesOverdue: prog.overdue,
        avgDelayDaysCompleted:
          prog.delayCount > 0 ? prog.delaySumDays / prog.delayCount : null,
      },
    };
  });

  return { projectId, projectName: project.name, asOf, rows };
}
