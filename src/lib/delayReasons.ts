// Aggregate open hindrances by reason code so the Dashboard can render a
// "Delay Reason Clusters" panel. Keyed by src/lib/hindranceReasons.ts codes,
// with NULL folded into an "Unspecified" bucket so untagged legacy rows
// still show up (nudge to backfill without hiding them).
//
// The per-contractor variant groups reasons under each contractor so admin
// can see which contractor is driving which cause — matches the way Colab
// presents it in its Contractor Delay Reasons view.

import { prisma } from "@/lib/prisma";
import { reasonLabel } from "@/lib/hindranceReasons";

export interface DelayReasonCluster {
  code: string;              // reason code, or "UNSPECIFIED"
  label: string;             // human label
  count: number;             // # of open hindrances with this reason
  daysImpact: number;        // sum of daysImpact (0 if all null)
  latestAt: string | null;   // ISO date of most recent hindrance in this bucket
  sampleNote: string | null; // one representative reasonNote, for context
}

export interface ContractorDelayReasonGroup {
  contractorId: string | null;   // null = hindrances without a contractor tag
  contractorName: string;
  totalCount: number;            // sum of counts across reasons under this contractor
  totalDaysImpact: number;
  reasons: DelayReasonCluster[]; // per-reason breakdown, sorted by count desc
}

/**
 * Group all OPEN hindrances on a project by reasonCode, sorted by count desc.
 * Only OPEN — resolved blockers are not currently causing delay.
 */
export async function getDelayReasonClusters(projectId: string): Promise<DelayReasonCluster[]> {
  const hindrances = await prisma.hindrance.findMany({
    where: { projectId, status: "OPEN" },
    select: {
      reasonCode: true,
      reasonNote: true,
      daysImpact: true,
      startDate: true,
    },
  });

  const byCode = new Map<string, DelayReasonCluster>();
  for (const h of hindrances) {
    const code = h.reasonCode ?? "UNSPECIFIED";
    upsertCluster(byCode, code, h);
  }

  return [...byCode.values()].sort((a, b) => b.count - a.count || b.daysImpact - a.daysImpact);
}

/**
 * Same rollup, but grouped by contractor. Contractor is resolved from the
 * hindrance's wbsNode.contractorId. Hindrances without a contractor link fold
 * into a "Project-level" bucket at the bottom.
 */
export async function getContractorDelayReasonGroups(projectId: string): Promise<ContractorDelayReasonGroup[]> {
  const hindrances = await prisma.hindrance.findMany({
    where: { projectId, status: "OPEN" },
    select: {
      reasonCode: true,
      reasonNote: true,
      daysImpact: true,
      startDate: true,
      wbsNode: { select: { contractorId: true } },
    },
  });

  // Contractor names — one query, keep it O(1) per hindrance.
  const contractorIds = [
    ...new Set(
      hindrances
        .map((h) => h.wbsNode?.contractorId)
        .filter((x): x is string => !!x),
    ),
  ];
  const contractors = contractorIds.length > 0
    ? await prisma.contractor.findMany({
        where: { id: { in: contractorIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(contractors.map((c) => [c.id, c.name]));

  // First bucket by contractor id, then by reason code within each.
  const byContractor = new Map<
    string, // key: contractorId or "__project__"
    { name: string; byReason: Map<string, DelayReasonCluster> }
  >();

  for (const h of hindrances) {
    const cid = h.wbsNode?.contractorId ?? "__project__";
    const cname = cid === "__project__" ? "Project-level (no contractor)" : (nameById.get(cid) ?? "Unknown contractor");
    const entry = byContractor.get(cid) ?? { name: cname, byReason: new Map() };
    if (!byContractor.has(cid)) byContractor.set(cid, entry);
    const code = h.reasonCode ?? "UNSPECIFIED";
    upsertCluster(entry.byReason, code, h);
  }

  // Flatten + sort — largest-impact contractors first.
  return [...byContractor.entries()]
    .map(([cid, v]) => {
      const reasons = [...v.byReason.values()].sort(
        (a, b) => b.count - a.count || b.daysImpact - a.daysImpact,
      );
      const totalCount = reasons.reduce((n, r) => n + r.count, 0);
      const totalDaysImpact = reasons.reduce((n, r) => n + r.daysImpact, 0);
      return {
        contractorId: cid === "__project__" ? null : cid,
        contractorName: v.name,
        totalCount,
        totalDaysImpact,
        reasons,
      };
    })
    .sort((a, b) => {
      // Project-level bucket sinks to the bottom regardless of impact.
      if (a.contractorId === null && b.contractorId !== null) return 1;
      if (a.contractorId !== null && b.contractorId === null) return -1;
      return b.totalDaysImpact - a.totalDaysImpact || b.totalCount - a.totalCount;
    });
}

// Shared upsert helper — DRY between the flat and the contractor-grouped views.
function upsertCluster(
  map: Map<string, DelayReasonCluster>,
  code: string,
  h: {
    reasonCode: string | null;
    reasonNote: string | null;
    daysImpact: number | null;
    startDate: Date;
  },
): void {
  const existing = map.get(code);
  if (existing) {
    existing.count += 1;
    existing.daysImpact += h.daysImpact ?? 0;
    const at = h.startDate.toISOString();
    if (!existing.latestAt || at > existing.latestAt) existing.latestAt = at;
    if (!existing.sampleNote && h.reasonNote) existing.sampleNote = h.reasonNote;
  } else {
    map.set(code, {
      code,
      label: code === "UNSPECIFIED" ? "Unspecified" : reasonLabel(code),
      count: 1,
      daysImpact: h.daysImpact ?? 0,
      latestAt: h.startDate.toISOString(),
      sampleNote: h.reasonNote ?? null,
    });
  }
}
