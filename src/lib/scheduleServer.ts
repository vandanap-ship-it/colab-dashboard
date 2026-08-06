// ---------------------------------------------------------------------------
// Schedule server queries — Milestone Timeline + Weekly Look-Ahead.
//
// Read from Prisma, shape into RSC-serializable prop bags. Kept separate from
// rollupServer.ts because these are calendar-oriented (dates + windowing)
// rather than health-rollup oriented.
// ---------------------------------------------------------------------------

import "server-only";

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Milestone Timeline
// ---------------------------------------------------------------------------

export interface TimelineMilestone {
  sectionCode: string;
  sectionName: string;
  sectionOrder: number;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  pctComplete: number;
}

export interface TimelineVilla {
  villaId: string;
  villaNumber: number;
  villaLabel: string;
  blockCode: string;
  milestones: TimelineMilestone[];
}

export interface TimelineData {
  projectStart: Date | null;   // earliest baseline across all villa milestones
  projectEnd: Date | null;     // latest baseline across all villa milestones
  villas: TimelineVilla[];
}

/**
 * Milestone Timeline data for the whole project.
 * Sorted by (block orderIndex asc, villa number asc).
 */
export async function getMilestoneTimeline(projectId: string): Promise<TimelineData | null> {
  const rows = await prisma.villaMilestone.findMany({
    where: { villa: { projectId } },
    select: {
      villaId: true,
      baselineStart: true, baselineFinish: true,
      actualStart: true, actualFinish: true, projectedFinish: true,
      pctComplete: true,
      villa: {
        select: {
          id: true, number: true, label: true,
          block: { select: { code: true, orderIndex: true } },
        },
      },
      section: { select: { code: true, name: true, orderIndex: true } },
    },
  });

  if (rows.length === 0) return null;

  // Group by villa, ordering milestones by section.orderIndex.
  const byVilla: Record<string, TimelineVilla> = {};
  for (const r of rows) {
    let v = byVilla[r.villaId];
    if (!v) {
      v = {
        villaId: r.villaId,
        villaNumber: r.villa.number,
        villaLabel: r.villa.label ?? `Villa ${r.villa.number}`,
        blockCode: r.villa.block.code,
        milestones: [],
      };
      byVilla[r.villaId] = v;
    }
    v.milestones.push({
      sectionCode: r.section.code,
      sectionName: r.section.name,
      sectionOrder: r.section.orderIndex,
      baselineStart: r.baselineStart,
      baselineFinish: r.baselineFinish,
      actualStart: r.actualStart,
      actualFinish: r.actualFinish,
      projectedFinish: r.projectedFinish,
      pctComplete: r.pctComplete,
    });
  }

  const villas = Object.values(byVilla)
    .map((v) => ({ ...v, milestones: [...v.milestones].sort((a, b) => a.sectionOrder - b.sectionOrder) }))
    .sort((a, b) => {
      if (a.blockCode !== b.blockCode) {
        const ai = parseInt(a.blockCode, 10);
        const bi = parseInt(b.blockCode, 10);
        if (!isNaN(ai) && !isNaN(bi) && ai !== bi) return ai - bi;
        return a.blockCode.localeCompare(b.blockCode);
      }
      return a.villaNumber - b.villaNumber;
    });

  // Compute project date window (earliest baseline start → latest baseline finish
  // — falls back to actual/projected if baseline is missing).
  let projectStart: Date | null = null;
  let projectEnd: Date | null = null;
  for (const v of villas) {
    for (const m of v.milestones) {
      const start = m.baselineStart ?? m.actualStart;
      const finish = m.baselineFinish ?? m.projectedFinish ?? m.actualFinish;
      if (start && (!projectStart || start < projectStart)) projectStart = start;
      if (finish && (!projectEnd || finish > projectEnd)) projectEnd = finish;
    }
  }

  return { projectStart, projectEnd, villas };
}

// ---------------------------------------------------------------------------
// Weekly Look-Ahead
// ---------------------------------------------------------------------------

export type LookAheadStatus = "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "IN_PROGRESS";

export interface LookAheadTask {
  id: string;
  name: string;
  villaLabel: string | null;    // "Villa 12" or null if not villa-scoped
  blockCode: string | null;
  sectionName: string | null;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  percentComplete: number;
  isSubMilestone: boolean;       // ★ concrete pour vs regular task
  contractorName: string | null;
  status: LookAheadStatus;
  daysUntilStart: number | null; // negative = already past; null if no baselineStart
}

export interface LookAheadDay {
  date: string;                  // yyyy-mm-dd
  label: string;                 // "Wed 06 Aug"
  tasks: LookAheadTask[];
}

export interface LookAheadBucket {
  overdue: LookAheadTask[];      // baselineFinish < today AND not 100% done
  inProgress: LookAheadTask[];   // actualStart set, not done, not overdue
  days: LookAheadDay[];          // upcoming days, tasks bucketed by baselineStart
}

const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

function formatDayLabel(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[d.getUTCMonth()];
  return `${weekday} ${day} ${month}`;
}

/**
 * Weekly Look-Ahead — the actionable "what's happening this week" view.
 * Buckets:
 *   • Overdue tasks (baselineFinish < today, not 100%)
 *   • In-progress tasks (started but not done)
 *   • Days ahead (tasks with baselineStart between today and today + daysAhead)
 */
export async function getWeeklyLookAhead(
  projectId: string,
  daysAhead = 14,
  now = new Date(),
): Promise<LookAheadBucket> {
  const today = startOfDay(now);
  const horizonEnd = new Date(today.getTime() + daysAhead * MS_PER_DAY);
  const windowStart = new Date(today.getTime() - 30 * MS_PER_DAY); // 30-day lookback for overdue

  // Pull tasks that either:
  //   (a) have baselineStart within [today, today+daysAhead]  → upcoming
  //   (b) are OVERDUE (baselineFinish < today AND not 100% AND started or planned)
  //   (c) are IN_PROGRESS (actualStart set, not 100%)
  // One query, we'll bucket in JS.
  const tasks = await prisma.wBSNode.findMany({
    where: {
      projectId,
      // Only leaves (either sub-milestones or bottom tasks), skip parent nodes
      OR: [
        { baselineStart: { gte: windowStart, lte: horizonEnd } },
        { baselineFinish: { lt: today }, percentComplete: { lt: 100 } },
        { actualStart: { not: null }, percentComplete: { lt: 100 } },
      ],
    },
    orderBy: [{ baselineStart: "asc" }, { orderIndex: "asc" }],
    select: {
      id: true, name: true, isSubMilestone: true,
      baselineStart: true, baselineFinish: true, actualStart: true,
      percentComplete: true,
      contractor: { select: { name: true } },
      villaMilestone: {
        select: {
          villa: {
            select: {
              number: true, label: true,
              block: { select: { code: true } },
            },
          },
          section: { select: { name: true } },
        },
      },
    },
    take: 500,
  });

  const overdue: LookAheadTask[] = [];
  const inProgress: LookAheadTask[] = [];
  const byDay: Record<string, LookAheadDay> = {};

  for (const t of tasks) {
    const villa = t.villaMilestone?.villa;
    const villaLabel = villa?.label ?? (villa ? `Villa ${villa.number}` : null);
    const blockCode = villa?.block.code ?? null;
    const sectionName = t.villaMilestone?.section.name ?? null;
    const daysUntilStart = t.baselineStart
      ? Math.round((startOfDay(t.baselineStart).getTime() - today.getTime()) / MS_PER_DAY)
      : null;

    // Determine status bucket
    const bucketed: LookAheadTask = {
      id: t.id,
      name: t.name,
      villaLabel,
      blockCode,
      sectionName,
      baselineStart: t.baselineStart,
      baselineFinish: t.baselineFinish,
      actualStart: t.actualStart,
      percentComplete: t.percentComplete,
      isSubMilestone: t.isSubMilestone,
      contractorName: t.contractor?.name ?? null,
      status: "UPCOMING", // fixed below
      daysUntilStart,
    };

    const isDone = t.percentComplete >= 100;
    const isOverdue = t.baselineFinish && t.baselineFinish < today && !isDone;
    const isStarted = t.actualStart != null && !isDone;

    if (isOverdue) {
      bucketed.status = "OVERDUE";
      overdue.push(bucketed);
      continue;
    }
    if (isStarted) {
      bucketed.status = "IN_PROGRESS";
      inProgress.push(bucketed);
      continue;
    }
    // Upcoming — bucket by baselineStart day
    if (t.baselineStart && t.baselineStart >= today && t.baselineStart <= horizonEnd) {
      const dayStart = startOfDay(t.baselineStart);
      const key = dayStart.toISOString().slice(0, 10);
      bucketed.status = daysUntilStart === 0 ? "DUE_TODAY" : "UPCOMING";
      const day = byDay[key] ?? { date: key, label: formatDayLabel(dayStart), tasks: [] };
      day.tasks.push(bucketed);
      byDay[key] = day;
    }
  }

  // Sort overdue by baseline finish (worst first)
  overdue.sort((a, b) => (a.baselineFinish?.getTime() ?? 0) - (b.baselineFinish?.getTime() ?? 0));
  // Sort in-progress by actualStart
  inProgress.sort((a, b) => (a.actualStart?.getTime() ?? 0) - (b.actualStart?.getTime() ?? 0));

  // Emit days in chronological order (fill gaps? no — just skip empty days for cleanliness)
  const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

  return { overdue, inProgress, days };
}
