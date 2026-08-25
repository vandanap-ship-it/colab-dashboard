// Rules-based "smart callouts" for the Insights tab. Each rule inspects real
// project data, decides whether the condition is worth surfacing, and emits
// a card with a headline + supporting metric + link to affected villas.
//
// No AI here — every callout is a deterministic pattern the site team can
// verify. Rules run daily; a card appears or disappears as the underlying
// data changes.

import { prisma } from "@/lib/prisma";
import { reasonLabel } from "@/lib/hindranceReasons";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type InsightSeverity = "info" | "warning" | "critical";

export interface Insight {
  id: string;          // rule slug
  severity: InsightSeverity;
  title: string;       // headline shown large
  detail: string;      // supporting sentence, 1-2 lines
  metric?: { label: string; value: string };
  affectedVillas?: number[]; // click-through targets
  linkHref?: string;
  linkLabel?: string;
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

// Weekdays: 0 = Sun, 1 = Mon ... 6 = Sat
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

export async function getSmartInsights(projectId: string, today: Date = new Date()): Promise<Insight[]> {
  const todayStart = toDay(today);

  // Fetch everything the rules might need, in one parallel wave.
  const [project, villas, progressEntries, hindrances, tradePlans, manpower, inspections, blocks] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { reraEndDate: true, projectedEndDate: true, endDate: true },
    }),
    prisma.villa.findMany({
      where: { projectId, inScope: true },
      select: {
        id: true,
        number: true,
        label: true,
        block: { select: { code: true } },
        milestones: {
          select: {
            baselineFinish: true,
            actualStart: true,
            actualFinish: true,
            projectedFinish: true,
            pctComplete: true,
            section: { select: { name: true, orderIndex: true } },
          },
          orderBy: { section: { orderIndex: "asc" } },
        },
      },
    }),
    prisma.progressEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        date: { gte: new Date(todayStart.getTime() - 14 * 86400000) },
      },
      select: {
        date: true,
        wbsNode: {
          select: {
            villaMilestone: { select: { villaId: true } },
          },
        },
      },
    }),
    prisma.hindrance.findMany({
      where: { projectId, status: "OPEN" },
      select: { reasonCode: true, daysImpact: true, wbsNode: { select: { villaId: true } } },
    }),
    prisma.tradePlan.findMany({
      where: {
        projectId,
        deletedAt: null,
        startDate: { lte: todayStart },
        OR: [{ endDate: null }, { endDate: { gt: todayStart } }],
      },
      select: { plannedCount: true },
    }),
    prisma.manpowerEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        entryDate: { gte: new Date(todayStart.getTime() - 28 * 86400000) },
      },
      select: { entryDate: true, actualCount: true },
    }),
    prisma.inspection.findMany({
      where: { projectId, deletedAt: null, status: "IN_REVIEW" },
      select: { id: true, createdAt: true, title: true, module: true },
    }),
    prisma.block.findMany({
      where: { projectId, active: true },
      select: { code: true },
    }),
  ]);

  const insights: Insight[] = [];

  // ------- Rule 1: Stalled villas per block (>7 days without a progress entry) -------
  {
    const lastEntryByVilla = new Map<string, Date>();
    for (const e of progressEntries) {
      const vid = e.wbsNode.villaMilestone?.villaId;
      if (!vid) continue;
      const prev = lastEntryByVilla.get(vid);
      if (!prev || e.date > prev) lastEntryByVilla.set(vid, e.date);
    }
    const stalledByBlock = new Map<string, number[]>(); // blockCode → villa numbers
    for (const v of villas) {
      const started = v.milestones.some((m) => m.actualStart);
      if (!started) continue;
      const last = lastEntryByVilla.get(v.id);
      const stale = !last || daysBetween(last, today) > 7;
      if (!stale) continue;
      if (!stalledByBlock.has(v.block.code)) stalledByBlock.set(v.block.code, []);
      stalledByBlock.get(v.block.code)!.push(v.number);
    }
    const worst = [...stalledByBlock.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (worst && worst[1].length >= 3) {
      insights.push({
        id: "stalled-block",
        severity: worst[1].length >= 5 ? "critical" : "warning",
        title: `${worst[1].length} villas stalled >7 days in Block ${worst[0]}`,
        detail: `No progress entries logged in the last week for villas ${worst[1].sort((a, b) => a - b).map((n) => "V" + n).join(", ")}.`,
        metric: { label: "villas stalled", value: String(worst[1].length) },
        affectedVillas: worst[1],
      });
    }
  }

  // ------- Rule 2: Top delay reason driver -------
  {
    const byReason = new Map<string, { count: number; days: number; villas: Set<number> }>();
    // Need villa number from wbsNode.villaId → look up
    const villaIdToNumber = new Map(villas.map((v) => [v.id, v.number]));
    for (const h of hindrances) {
      const code = h.reasonCode ?? "UNSPECIFIED";
      const existing = byReason.get(code) ?? { count: 0, days: 0, villas: new Set() };
      existing.count++;
      existing.days += h.daysImpact ?? 0;
      const vNum = h.wbsNode?.villaId ? villaIdToNumber.get(h.wbsNode.villaId) : undefined;
      if (vNum != null) existing.villas.add(vNum);
      byReason.set(code, existing);
    }
    const top = [...byReason.entries()].sort((a, b) => b[1].days - a[1].days || b[1].count - a[1].count)[0];
    if (top && top[1].count >= 3) {
      insights.push({
        id: "top-delay-reason",
        severity: top[1].days >= 30 ? "critical" : "warning",
        title: `${reasonLabel(top[0])} is driving ${top[1].days || "N/A"} days of delay`,
        detail: `${top[1].count} open hindrance${top[1].count === 1 ? "" : "s"} across ${top[1].villas.size} villa${top[1].villas.size === 1 ? "" : "s"} share this root cause. Freeze / expedite the ones you can.`,
        metric: { label: "days of delay", value: String(top[1].days) },
        affectedVillas: [...top[1].villas],
      });
    }
  }

  // ------- Rule 3: Day-of-week manpower shortfall pattern -------
  if (tradePlans.length > 0 && manpower.length > 0) {
    const plannedTotal = tradePlans.reduce((n, p) => n + p.plannedCount, 0);
    const byDayOfWeek = new Array(7).fill(0).map(() => ({ short: 0, total: 0 }));
    // Group manpower entries by day
    const totalByDay = new Map<number, number>();
    for (const m of manpower) {
      const dayMs = toDay(m.entryDate).getTime();
      totalByDay.set(dayMs, (totalByDay.get(dayMs) ?? 0) + m.actualCount);
    }
    for (const [dayMs, actual] of totalByDay) {
      const d = new Date(dayMs);
      const dow = d.getUTCDay();
      byDayOfWeek[dow].total++;
      if (actual < plannedTotal) byDayOfWeek[dow].short++;
    }
    const worstDow = byDayOfWeek
      .map((d, i) => ({ dow: i, ratio: d.total > 0 ? d.short / d.total : 0, samples: d.total }))
      .filter((d) => d.samples >= 2)
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (worstDow && worstDow.ratio >= 0.75 && worstDow.samples >= 3) {
      insights.push({
        id: "day-of-week-shortfall",
        severity: "warning",
        title: `Manpower short on ${WEEKDAY_NAMES[worstDow.dow]}s — ${worstDow.samples} weeks running`,
        detail: `Actual headcount fell below plan on ${Math.round(worstDow.ratio * 100)}% of recent ${WEEKDAY_NAMES[worstDow.dow]}s. Check for weekly no-show pattern.`,
        metric: { label: "shortfall rate", value: `${Math.round(worstDow.ratio * 100)}%` },
      });
    }
  }

  // ------- Rule 4: Villas projected to breach RERA -------
  if (project?.reraEndDate) {
    const rera = project.reraEndDate;
    const breaching: Array<{ villaNumber: number; breachDays: number }> = [];
    for (const v of villas) {
      const lastMilestone = v.milestones[v.milestones.length - 1];
      const finalFinish = lastMilestone?.projectedFinish ?? lastMilestone?.baselineFinish;
      if (finalFinish && finalFinish > rera) {
        breaching.push({
          villaNumber: v.number,
          breachDays: daysBetween(rera, finalFinish),
        });
      }
    }
    breaching.sort((a, b) => b.breachDays - a.breachDays);
    if (breaching.length > 0) {
      const worst = breaching[0];
      insights.push({
        id: "rera-breach",
        severity: worst.breachDays >= 60 ? "critical" : "warning",
        title: `${breaching.length} villa${breaching.length === 1 ? "" : "s"} projected to breach RERA`,
        detail: `Worst offender: Villa ${worst.villaNumber} at ${worst.breachDays} days beyond RERA. Acceleration or replan needed.`,
        metric: { label: "villas breaching", value: String(breaching.length) },
        affectedVillas: breaching.map((b) => b.villaNumber),
      });
    }
  }

  // ------- Rule 5: Low daily coverage % -------
  {
    let lowDayCount = 0;
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(todayStart.getTime() - i * 86400000);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const entriesThisDay = progressEntries.filter((e) => e.date >= dayStart && e.date < dayEnd);
      const villasUpdated = new Set(entriesThisDay.map((e) => e.wbsNode.villaMilestone?.villaId).filter(Boolean)).size;
      // Only consider days that had actual planned work — hard to compute per-day exactly here,
      // so approximate: if there was work happening at all this week, expect ≥ 25% of active villas.
      const activeVillasCount = villas.filter((v) => v.milestones.some((m) => m.actualStart && !m.actualFinish)).length;
      if (activeVillasCount === 0) continue;
      const coverage = villasUpdated / activeVillasCount;
      if (coverage < 0.25) lowDayCount++;
    }
    if (lowDayCount >= 3) {
      insights.push({
        id: "low-coverage",
        severity: lowDayCount >= 5 ? "critical" : "warning",
        title: `Low daily coverage — ${lowDayCount} of last 7 days below 25%`,
        detail: `Site engineers logged updates on less than a quarter of active villas on these days. Data hygiene affects report reliability.`,
        metric: { label: "low-coverage days", value: `${lowDayCount}/7` },
      });
    }
  }

  // ------- Rule 6: Milestone lag between consecutive sections -------
  {
    // Aggregate per section: % of villas that reached each.
    const sectionStats = new Map<number, { name: string; completed: number; total: number }>();
    for (const v of villas) {
      for (const m of v.milestones) {
        if (!m.section) continue;
        const key = m.section.orderIndex;
        const entry = sectionStats.get(key) ?? { name: m.section.name, completed: 0, total: 0 };
        entry.total++;
        if (m.actualFinish) entry.completed++;
        sectionStats.set(key, entry);
      }
    }
    const orderedKeys = [...sectionStats.keys()].sort((a, b) => a - b);
    let lagPair: { earlier: string; later: string; gap: number } | null = null;
    for (let i = 0; i < orderedKeys.length - 1; i++) {
      const a = sectionStats.get(orderedKeys[i])!;
      const b = sectionStats.get(orderedKeys[i + 1])!;
      const pctA = a.total > 0 ? (a.completed / a.total) * 100 : 0;
      const pctB = b.total > 0 ? (b.completed / b.total) * 100 : 0;
      const gap = pctA - pctB;
      // Look for gaps >= 40 percentage points where the earlier one is > 50%
      if (pctA >= 50 && gap >= 40) {
        if (!lagPair || gap > lagPair.gap) {
          lagPair = { earlier: a.name, later: b.name, gap };
        }
      }
    }
    if (lagPair) {
      insights.push({
        id: "milestone-lag",
        severity: "info",
        title: `${lagPair.later} is trailing ${lagPair.earlier} by ${Math.round(lagPair.gap)}pp`,
        detail: `Villas complete on ${lagPair.earlier} but not moving into ${lagPair.later}. Check for a bottleneck between the two stages.`,
        metric: { label: "completion gap", value: `${Math.round(lagPair.gap)}pp` },
      });
    }
  }

  // ------- Rule 7: Inspections stuck in review > 3 days -------
  {
    const stuck = inspections.filter((i) => daysBetween(i.createdAt, today) > 3);
    if (stuck.length >= 3) {
      const worst = stuck.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const worstDays = daysBetween(worst.createdAt, today);
      insights.push({
        id: "stuck-inspections",
        severity: stuck.length >= 10 ? "critical" : "warning",
        title: `${stuck.length} inspections stuck in review for >3 days`,
        detail: `Oldest is “${worst.title}” at ${worstDays} days in review. Nudge the reviewers before the queue grows.`,
        metric: { label: "in-review", value: String(stuck.length) },
        linkHref: "qaqc",
        linkLabel: "Open QA/QC",
      });
    }
  }

  // Rank: critical → warning → info; within each, keep insertion order.
  const severityRank: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // Blocks aren't currently used but kept in case a later rule needs them.
  void blocks;

  return insights;
}
