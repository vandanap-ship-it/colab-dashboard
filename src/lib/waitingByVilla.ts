import "server-only";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import {
  WIR_TIERS,
  PERMIT_TIERS,
  HINDRANCE_TIERS,
  CONCERN_TIERS,
  ISSUE_TIERS,
} from "@/lib/queueAge";

/**
 * Cross-queue villa breakdown for the mobile home's "Focus your walk"
 * strip. Same five queues + same SLA cutoffs the top-level Waiting-on-You
 * strip counts against — WIR (7d review SLA), Permit (2d), Hindrance
 * (3d), Concern (5d), Issue (4d). Everything a
 * villa carries across those five queues is summed, then villas with the
 * most waiting rows bubble to the top.
 *
 * Rationale: engineers who see "6 stale RFIs, 4 stale snags" on the home
 * still have to jump between queues to plan a site walk. A villa-first
 * rollup ("Villa 15 has 5 things waiting") lets them go villa-by-villa
 * instead of queue-by-queue — closer to how walks actually happen.
 *
 * Not tail-optimised. Each queue's stale row set is small (~50 rows max
 * in practice, capped at 500 for safety), and we run the six queries
 * in parallel via the caller's Promise.all. In-memory grouping by villa
 * label keeps the join logic simple + testable.
 *
 * Rows without a villa link (project-level WBS nodes, or nodes whose
 * villa milestone isn't set) are dropped — they'd all lump into a
 * "no villa" bucket that isn't actionable from a site-walk view.
 */

export type QueueKey = "wir" | "permit" | "hindrance" | "concern" | "issue";

export interface VillaWaitingCount {
  villaLabel: string;
  blockCode: string;
  total: number;
  byQueue: Record<QueueKey, number>;
}

const ROW_CAP = 500; // safety net; production has ~50 stale rows per queue max
const TOP_N = 4;

interface RowWithVilla {
  wbsNode: {
    villaMilestone: {
      villa: {
        label: string | null;
        number: number;
        block: { code: string };
      } | null;
    } | null;
  } | null;
}

/**
 * Extract (villaLabel, blockCode) from a queue row that has a wbsNode
 * with an eventual villa link. Returns null when the row has no
 * traceable villa — those rows are silently dropped from the rollup.
 */
function extractVilla(row: RowWithVilla): { label: string; block: string } | null {
  const v = row.wbsNode?.villaMilestone?.villa;
  if (!v) return null;
  const label = v.label ?? `Villa ${v.number}`;
  const block = v.block?.code ?? "";
  return { label, block };
}

export async function getWaitingByVilla(
  projectId: string,
  session: { user: { id: string; role: string; modules: string | null } } | null,
): Promise<VillaWaitingCount[]> {
  if (!session?.user) return [];
  const modules = session.user.modules;
  const canSeeQuality = canAccessModule(modules, MODULES.QAQC) || canAccessModule(modules, MODULES.SAFETY);
  const canSeeHindrance = canAccessModule(modules, MODULES.HINDRANCE);
  const canSeePermit = canAccessModule(modules, MODULES.PERMIT);
  const canSeeConcern = canAccessModule(modules, MODULES.CONCERN);

  const nowMs = Date.now();
  const wirCutoff = new Date(nowMs - WIR_TIERS.staleAt * 86_400_000);
  const permitCutoff = new Date(nowMs - PERMIT_TIERS.staleAt * 86_400_000);
  const hindranceCutoff = new Date(nowMs - HINDRANCE_TIERS.staleAt * 86_400_000);
  const concernCutoff = new Date(nowMs - CONCERN_TIERS.staleAt * 86_400_000);
  const issueCutoff = new Date(nowMs - ISSUE_TIERS.staleAt * 86_400_000);

  const villaSelect = {
    wbsNode: {
      select: {
        villaMilestone: {
          select: {
            villa: {
              select: {
                label: true,
                number: true,
                block: { select: { code: true } },
              },
            },
          },
        },
      },
    },
  } as const;

  const [wirs, permits, hindrances, concerns, issues] = await Promise.all([
    canSeeQuality
      ? prisma.inspection.findMany({
          where: { projectId, status: "IN_REVIEW", createdAt: { lt: wirCutoff } },
          select: villaSelect,
          take: ROW_CAP,
        })
      : Promise.resolve([]),
    canSeePermit
      ? prisma.workPermit.findMany({
          where: { projectId, status: "PENDING", createdAt: { lt: permitCutoff } },
          select: villaSelect,
          take: ROW_CAP,
        })
      : Promise.resolve([]),
    canSeeHindrance
      ? prisma.hindrance.findMany({
          where: { projectId, status: "OPEN", startDate: { lt: hindranceCutoff } },
          select: villaSelect,
          take: ROW_CAP,
        })
      : Promise.resolve([]),
    canSeeConcern
      ? prisma.concern.findMany({
          where: { projectId, status: "PENDING", createdAt: { lt: concernCutoff } },
          select: villaSelect,
          take: ROW_CAP,
        })
      : Promise.resolve([]),
    canSeeQuality
      ? prisma.issue.findMany({
          where: {
            projectId,
            status: { in: ["OPEN", "IN_REINSPECTION"] },
            createdAt: { lt: issueCutoff },
          },
          select: villaSelect,
          take: ROW_CAP,
        })
      : Promise.resolve([]),
  ]);

  // Bucket by villa label. blockCode is captured on first sighting; a
  // villa can only belong to one block so later rows can't disagree.
  const bucket = new Map<string, VillaWaitingCount>();
  const tally = (rows: RowWithVilla[], key: QueueKey) => {
    for (const r of rows) {
      const v = extractVilla(r);
      if (!v) continue;
      const existing = bucket.get(v.label);
      if (existing) {
        existing.total += 1;
        existing.byQueue[key] += 1;
      } else {
        bucket.set(v.label, {
          villaLabel: v.label,
          blockCode: v.block,
          total: 1,
          byQueue: { wir: 0, permit: 0, hindrance: 0, concern: 0, issue: 0, [key]: 1 } as Record<QueueKey, number>,
        });
      }
    }
  };
  tally(wirs, "wir");
  tally(permits, "permit");
  tally(hindrances, "hindrance");
  tally(concerns, "concern");
  tally(issues, "issue");

  // Top villas by total; alphabetical (label) as tiebreak so the order
  // is stable across renders and doesn't jitter when counts match.
  return Array.from(bucket.values())
    .sort((a, b) => b.total - a.total || a.villaLabel.localeCompare(b.villaLabel))
    .slice(0, TOP_N);
}
