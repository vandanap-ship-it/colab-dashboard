// Aggregate delay reasons for the Dashboard "Delay Reason Clusters" panel.
//
// Prior to 2026-11-04 this module only read `Hindrance` rows - which on
// Amanvana held 1 total / 0 open, so the card rendered an empty state on
// every management review. In reality the site team tags delays on every
// ProgressEntry via `reasonCode` + `reasonNote`, and the Colab import also
// writes into ProgressEntry. Those together carry ~600 tagged delays on
// Amanvana - the real story management wants to see.
//
// So this module now reads ProgressEntry.reasonCode as the primary source
// (Siddhi-native + Colab-imported both land there), and Hindrance rows are
// appended as a secondary bucket if any are open - they normally add zero.
//
// Shape is unchanged so the DelayReasonsCard component keeps working.

import { prisma } from "@/lib/prisma";
import { reasonLabel } from "@/lib/hindranceReasons";

export interface DelayReasonCluster {
  code: string;              // reason code, or "UNSPECIFIED"
  label: string;             // human label
  count: number;             // # of tagged delays in this bucket
  daysImpact: number;        // sum of days-impact (0 if none carried)
  latestAt: string | null;   // ISO date of most recent tagged entry
  sampleNote: string | null; // one representative reasonNote, for context
  /** For the OTHER / UNSPECIFIED buckets: the reasonNote verbatim text
   *  bucketed by case-folded phrase so the dashboard can show WHAT the
   *  site team actually wrote under the catch-all label. undefined for
   *  the typed reason codes. */
  subPhrases?: Array<{ phrase: string; count: number }>;
}

export interface ContractorDelayReasonGroup {
  contractorId: string | null;   // null = entries without a contractor tag
  contractorName: string;
  totalCount: number;            // sum of counts across reasons under this contractor
  totalDaysImpact: number;
  reasons: DelayReasonCluster[]; // per-reason breakdown, sorted by count desc
}

/**
 * Group every delay-tagged ProgressEntry on a project by reasonCode, sorted
 * by count desc. Unioned with any OPEN Hindrance rows that carry a reason
 * (rare today but kept so the card doesn't regress when hindrance logging
 * picks up). Count is the number of tagged logs - not the number of
 * distinct days - because the site team writes one per activity-day, which
 * is already the useful granularity.
 */
export async function getDelayReasonClusters(projectId: string): Promise<DelayReasonCluster[]> {
  const [progress, hindrances] = await Promise.all([
    prisma.progressEntry.findMany({
      where: { projectId, deletedAt: null, reasonCode: { not: null } },
      select: {
        reasonCode: true,
        reasonNote: true,
        date: true,
      },
      orderBy: { date: "desc" },
    }),
    prisma.hindrance.findMany({
      where: { projectId, status: "OPEN", reasonCode: { not: null } },
      select: {
        reasonCode: true,
        reasonNote: true,
        daysImpact: true,
        startDate: true,
      },
    }),
  ]);

  const byCode = new Map<string, DelayReasonCluster>();
  for (const p of progress) {
    const code = p.reasonCode ?? "UNSPECIFIED";
    upsertCluster(byCode, code, {
      reasonCode: p.reasonCode,
      reasonNote: p.reasonNote,
      daysImpact: null,
      at: p.date,
    });
  }
  for (const h of hindrances) {
    const code = h.reasonCode ?? "UNSPECIFIED";
    upsertCluster(byCode, code, {
      reasonCode: h.reasonCode,
      reasonNote: h.reasonNote,
      daysImpact: h.daysImpact,
      at: h.startDate,
    });
  }

  // Attach sub-phrase breakdown for the catch-all buckets so "Other · 111"
  // isn't opaque in the dashboard - management clicks and sees the actual
  // phrases the site team typed.
  for (const cluster of byCode.values()) {
    if (cluster.code === "OTHER" || cluster.code === "UNSPECIFIED") {
      cluster.subPhrases = buildSubPhrases(
        progress.filter((p) => (p.reasonCode ?? "UNSPECIFIED") === cluster.code).map((p) => p.reasonNote),
      );
    }
  }

  return [...byCode.values()].sort((a, b) => b.count - a.count || b.daysImpact - a.daysImpact);
}

/** Case-fold + trim + collapse whitespace on reasonNote; take the first chunk
 *  before " · " (the site team usually writes "<reason tag> · <status>").
 *  Returns at most 20 phrases, newest-count first. */
function buildSubPhrases(notes: Array<string | null>): Array<{ phrase: string; count: number }> {
  const counts = new Map<string, number>();
  for (const raw of notes) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    const head = trimmed.split(" · ")[0].trim().toLowerCase().replace(/\s+/g, " ");
    if (!head) continue;
    counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/**
 * Same rollup, grouped by contractor. Contractor is resolved from the row's
 * contractorId directly on ProgressEntry (no wbsNode join needed) with
 * Hindrance falling back to wbsNode.contractorId as before. Rows without a
 * contractor link fall into a "Project-level" bucket at the bottom.
 */
export async function getContractorDelayReasonGroups(projectId: string): Promise<ContractorDelayReasonGroup[]> {
  const [progress, hindrances] = await Promise.all([
    prisma.progressEntry.findMany({
      where: { projectId, deletedAt: null, reasonCode: { not: null } },
      select: {
        reasonCode: true,
        reasonNote: true,
        date: true,
        contractorId: true,
      },
      orderBy: { date: "desc" },
    }),
    prisma.hindrance.findMany({
      where: { projectId, status: "OPEN", reasonCode: { not: null } },
      select: {
        reasonCode: true,
        reasonNote: true,
        daysImpact: true,
        startDate: true,
        wbsNode: { select: { contractorId: true } },
      },
    }),
  ]);

  // Resolve contractor names once.
  const contractorIds = [
    ...new Set([
      ...progress.map((p) => p.contractorId).filter((x): x is string => !!x),
      ...hindrances.map((h) => h.wbsNode?.contractorId).filter((x): x is string => !!x),
    ]),
  ];
  const contractors = contractorIds.length > 0
    ? await prisma.contractor.findMany({
        where: { id: { in: contractorIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(contractors.map((c) => [c.id, c.name]));

  const byContractor = new Map<
    string, // key: contractorId or "__project__"
    { name: string; byReason: Map<string, DelayReasonCluster> }
  >();

  const push = (
    cid: string | null | undefined,
    code: string | null,
    note: string | null,
    daysImpact: number | null,
    at: Date,
  ) => {
    const key = cid ?? "__project__";
    const name = cid ? nameById.get(cid) ?? "Unknown contractor" : "Project-level (no contractor)";
    const entry = byContractor.get(key) ?? { name, byReason: new Map() };
    if (!byContractor.has(key)) byContractor.set(key, entry);
    upsertCluster(entry.byReason, code ?? "UNSPECIFIED", {
      reasonCode: code, reasonNote: note, daysImpact, at,
    });
  };

  for (const p of progress) {
    push(p.contractorId ?? null, p.reasonCode, p.reasonNote, null, p.date);
  }
  for (const h of hindrances) {
    push(h.wbsNode?.contractorId ?? null, h.reasonCode, h.reasonNote, h.daysImpact, h.startDate);
  }

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
      if (a.contractorId === null && b.contractorId !== null) return 1;
      if (a.contractorId !== null && b.contractorId === null) return -1;
      return b.totalCount - a.totalCount || b.totalDaysImpact - a.totalDaysImpact;
    });
}

function upsertCluster(
  map: Map<string, DelayReasonCluster>,
  code: string,
  h: {
    reasonCode: string | null;
    reasonNote: string | null;
    daysImpact: number | null;
    at: Date;
  },
): void {
  const existing = map.get(code);
  if (existing) {
    existing.count += 1;
    existing.daysImpact += h.daysImpact ?? 0;
    const at = h.at.toISOString();
    if (!existing.latestAt || at > existing.latestAt) existing.latestAt = at;
    if (!existing.sampleNote && h.reasonNote) existing.sampleNote = h.reasonNote;
  } else {
    map.set(code, {
      code,
      label: code === "UNSPECIFIED" ? "Unspecified" : reasonLabel(code),
      count: 1,
      daysImpact: h.daysImpact ?? 0,
      latestAt: h.at.toISOString(),
      sampleNote: h.reasonNote ?? null,
    });
  }
}
