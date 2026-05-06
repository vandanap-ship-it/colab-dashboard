import { prisma } from "@/lib/prisma";

/**
 * Daily Progress Report data — everything that should appear on a single
 * day's DPR for one project. The PDF view consumes this directly; nothing
 * here is presentational.
 */

export type DprData = {
  project: { id: string; name: string; code: string | null; address: string | null; tagline: string | null };
  date: string; // ISO YYYY-MM-DD
  generatedAt: Date;

  totals: {
    activitiesUpdated: number;
    labourByCategory: Record<string, number>;
    totalLabour: number;
    contractorsOnSite: number;
  };

  progressEntries: Array<{
    id: string;
    activityName: string;
    location: string | null;
    contractorName: string | null;
    achievedQuantity: number;
    cumulativeQuantity: number;
    unit: string | null;
    totalQuantity: number | null;
    activityPercentComplete: number;
    labour: Array<{ category: string; count: number }>;
    notes: string | null;
    photos: Array<{ id: string; url: string }>;
  }>;

  hindrancesRaised: Array<{ id: string; description: string; status: string }>;
  hindrancesResolved: Array<{ id: string; description: string }>;
  issuesRaised: Array<{ id: string; description: string; severity: string | null }>;
  issuesResolved: Array<{ id: string; description: string }>;
  concernsRaised: Array<{ id: string; description: string }>;
  concernsResolved: Array<{ id: string; description: string }>;
};

function parseDate(iso: string): { start: Date; end: Date } {
  // iso = YYYY-MM-DD; we want UTC day boundaries.
  const [yy, mm, dd] = iso.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(yy, mm - 1, dd));
  const end = new Date(Date.UTC(yy, mm - 1, dd + 1));
  return { start, end };
}

export async function getDprData(projectId: string, dateIso: string): Promise<DprData | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true, address: true, tagline: true },
  });
  if (!project) return null;

  const { start, end } = parseDate(dateIso);

  // Build a path map by walking parents so we can show "Phase / Floor / Room" location.
  const allNodes = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true },
  });
  const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
  const parentById = new Map(allNodes.map((n) => [n.id, n.parentId]));
  const pathFor = (id: string): string => {
    const parts: string[] = [];
    let cur: string | null = parentById.get(id) ?? null;
    let depth = 0;
    while (cur && depth < 6) {
      parts.push(nameById.get(cur) ?? "");
      cur = parentById.get(cur) ?? null;
      depth += 1;
    }
    return parts.reverse().filter(Boolean).join(" / ") || "—";
  };

  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: start, lt: end } },
    orderBy: [{ createdAt: "asc" }],
    include: {
      contractor: { select: { name: true } },
      wbsNode: {
        select: {
          id: true,
          name: true,
          unit: true,
          totalQuantity: true,
          percentComplete: true,
        },
      },
      photos: { select: { id: true, url: true }, orderBy: { uploadedAt: "asc" } },
    },
  });

  const entryIds = entries.map((e) => e.id);
  const labourRows = entryIds.length
    ? await prisma.progressLabour.findMany({
        where: { progressEntryId: { in: entryIds } },
        select: { progressEntryId: true, category: true, count: true },
      })
    : [];

  const labourByEntry = new Map<string, { category: string; count: number }[]>();
  for (const l of labourRows) {
    const arr = labourByEntry.get(l.progressEntryId) ?? [];
    arr.push({ category: l.category, count: l.count });
    labourByEntry.set(l.progressEntryId, arr);
  }

  // ---- Totals ----
  const labourByCategory: Record<string, number> = {};
  for (const l of labourRows) {
    labourByCategory[l.category] = (labourByCategory[l.category] ?? 0) + l.count;
  }
  const totalLabour = labourRows.reduce((s, l) => s + l.count, 0);
  const contractorsOnSite = new Set(entries.map((e) => e.contractor?.name).filter(Boolean)).size;

  const progressEntries: DprData["progressEntries"] = entries.map((e) => ({
    id: e.id,
    activityName: e.wbsNode.name,
    location: pathFor(e.wbsNode.id),
    contractorName: e.contractor?.name ?? null,
    achievedQuantity: e.achievedQuantity,
    cumulativeQuantity: e.cumulativeQuantity,
    unit: e.wbsNode.unit,
    totalQuantity: e.wbsNode.totalQuantity,
    activityPercentComplete: e.wbsNode.percentComplete,
    labour: labourByEntry.get(e.id) ?? [],
    notes: e.notes,
    photos: e.photos.map((p) => ({ id: p.id, url: p.url })),
  }));

  // ---- Hindrances / Issues / Concerns ----
  const [hindrancesRaisedRows, hindrancesResolvedRows, issuesRaisedRows, issuesResolvedRows, concernsRaisedRows, concernsResolvedRows] =
    await Promise.all([
      prisma.hindrance.findMany({
        where: { projectId, createdAt: { gte: start, lt: end } },
        select: { id: true, description: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.hindrance.findMany({
        where: { projectId, status: "RESOLVED", updatedAt: { gte: start, lt: end } },
        select: { id: true, description: true },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.issue.findMany({
        where: { projectId, createdAt: { gte: start, lt: end } },
        select: { id: true, description: true, severity: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.issue.findMany({
        where: { projectId, status: "RESOLVED", updatedAt: { gte: start, lt: end } },
        select: { id: true, description: true },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.concern.findMany({
        where: { projectId, createdAt: { gte: start, lt: end } },
        select: { id: true, description: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.concern.findMany({
        where: { projectId, status: "RESOLVED", updatedAt: { gte: start, lt: end } },
        select: { id: true, description: true },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

  return {
    project,
    date: dateIso,
    generatedAt: new Date(),
    totals: {
      activitiesUpdated: progressEntries.length,
      labourByCategory,
      totalLabour,
      contractorsOnSite,
    },
    progressEntries,
    hindrancesRaised: hindrancesRaisedRows,
    hindrancesResolved: hindrancesResolvedRows,
    issuesRaised: issuesRaisedRows,
    issuesResolved: issuesResolvedRows,
    concernsRaised: concernsRaisedRows,
    concernsResolved: concernsResolvedRows,
  };
}
