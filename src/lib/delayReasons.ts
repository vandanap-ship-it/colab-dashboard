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
  /** Which of the raw reason codes were folded into this bucket - shown
   *  in the dashboard tooltip so the merge is transparent to viewers. */
  mergedFrom?: string[];
}

// ─── Consolidation map (Vandana 2026-11-05) ─────────────────────────────
//
// Site team's raw reason codes are too granular for a management report.
// This maps each raw code to a management-level bucket. CHANGE_ORDER,
// PRIORITY_CHANGE and MEP_DRAWING are all the same root cause (the drawing
// or priority shifted), so they roll up together as "Design-driven".
// DELAYED_ENTRY is an admin lag (someone logged yesterday's progress
// today), not a real cause of site slip, so it folds into OTHER rather
// than standing on its own.

interface Group {
  code: string;
  label: string;
  members: string[];
}

const GROUPS: Group[] = [
  { code: "DESIGN_DRIVEN", label: "Design-driven", members: ["CHANGE_ORDER", "PRIORITY_CHANGE", "MEP_DRAWING"] },
  { code: "MATERIAL",      label: "Material",      members: ["MATERIAL"] },
  { code: "LABOUR",        label: "Manpower / labour", members: ["LABOUR"] },
  { code: "WEATHER",       label: "Weather",       members: ["WEATHER"] },
  { code: "OTHER",         label: "Other",         members: ["OTHER", "DELAYED_ENTRY", "UNSPECIFIED"] },
];

const CODE_TO_GROUP = new Map<string, Group>();
for (const g of GROUPS) {
  for (const m of g.members) CODE_TO_GROUP.set(m, g);
}
function groupFor(code: string | null): Group {
  return CODE_TO_GROUP.get((code ?? "UNSPECIFIED").toUpperCase()) ?? GROUPS[GROUPS.length - 1];
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

  // Bucket by GROUP (consolidated), not raw code. Each group tracks the
  // list of raw codes folded in so the UI can show the merge transparently.
  const byGroup = new Map<string, DelayReasonCluster & { mergedCodes: Set<string> }>();
  const addToGroup = (code: string | null, note: string | null, daysImpact: number | null, at: Date) => {
    const g = groupFor(code);
    const existing = byGroup.get(g.code);
    const rawCode = (code ?? "UNSPECIFIED").toUpperCase();
    if (existing) {
      existing.count += 1;
      existing.daysImpact += daysImpact ?? 0;
      const ts = at.toISOString();
      if (!existing.latestAt || ts > existing.latestAt) existing.latestAt = ts;
      if (!existing.sampleNote && note) existing.sampleNote = note;
      existing.mergedCodes.add(rawCode);
    } else {
      byGroup.set(g.code, {
        code: g.code,
        label: g.label,
        count: 1,
        daysImpact: daysImpact ?? 0,
        latestAt: at.toISOString(),
        sampleNote: note ?? null,
        mergedCodes: new Set([rawCode]),
      });
    }
  };
  for (const p of progress) addToGroup(p.reasonCode, p.reasonNote, null, p.date);
  for (const h of hindrances) addToGroup(h.reasonCode, h.reasonNote, h.daysImpact, h.startDate);

  // Attach sub-phrase breakdown for the "Other" catch-all so management can
  // click and see WHAT the site team wrote under it.
  for (const cluster of byGroup.values()) {
    if (cluster.code === "OTHER") {
      const notes = progress
        .filter((p) => groupFor(p.reasonCode).code === "OTHER")
        .map((p) => p.reasonNote);
      cluster.subPhrases = buildSubPhrases(notes);
    }
  }

  return [...byGroup.values()]
    .map(({ mergedCodes, ...rest }) => ({ ...rest, mergedFrom: [...mergedCodes].sort() }))
    .sort((a, b) => b.count - a.count || b.daysImpact - a.daysImpact);
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
