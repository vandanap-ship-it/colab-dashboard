// Aggregate open hindrances by reason code so the Dashboard can render a
// "Delay Reason Clusters" panel. Keyed by src/lib/hindranceReasons.ts codes,
// with NULL folded into an "Unspecified" bucket so untagged legacy rows
// still show up (nudge to backfill without hiding them).

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
    const existing = byCode.get(code);
    if (existing) {
      existing.count += 1;
      existing.daysImpact += h.daysImpact ?? 0;
      const at = h.startDate.toISOString();
      if (!existing.latestAt || at > existing.latestAt) existing.latestAt = at;
      if (!existing.sampleNote && h.reasonNote) existing.sampleNote = h.reasonNote;
    } else {
      byCode.set(code, {
        code,
        label: code === "UNSPECIFIED" ? "Unspecified" : reasonLabel(code),
        count: 1,
        daysImpact: h.daysImpact ?? 0,
        latestAt: h.startDate.toISOString(),
        sampleNote: h.reasonNote ?? null,
      });
    }
  }

  return [...byCode.values()].sort((a, b) => b.count - a.count || b.daysImpact - a.daysImpact);
}
