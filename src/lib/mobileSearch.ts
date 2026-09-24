import "server-only";

import { prisma } from "@/lib/prisma";
import {
  canAccessModule,
  canAccessScopedRow,
  isScopedUser,
  primaryModuleFor,
  MODULES,
} from "@/lib/modules";
import {
  WORK_PERMIT_TYPE_LABELS,
  type WorkPermitType,
} from "@/lib/workPermit";

/**
 * Cross-entity search for the mobile app.
 *
 * One free-text query hits every "thing" on the project the user has access
 * to — activities, snags, concerns, hindrances, work permits, and WIRs —
 * and returns a small (≤ 5 per type) list of matches. The scoped user
 * checks are applied per-table so a QAQC-only contractor searching
 * for "concrete" only sees their own QAQC snags and inspections, not
 * SAFETY ones or general items outside their module.
 *
 * The search is naive substring matching (case-insensitive) — no ranking,
 * no synonyms — which is fine for the current data volume (Amanvana has
 * a few thousand rows per table). If the volume grows, swap the LIKE
 * calls for pg's `to_tsvector` / GIN.
 */

const PER_TYPE_LIMIT = 5;

export interface MobileSearchResult {
  activities: {
    id: string;
    name: string;
    taskCode: string;
    villaLabel: string | null;
    blockCode: string | null;
    sectionName: string | null;
  }[];
  snags: {
    id: string;
    description: string;
    severity: string | null;
    status: string;
  }[];
  concerns: {
    id: string;
    description: string;
    status: string;
  }[];
  hindrances: {
    id: string;
    description: string;
    status: string;
  }[];
  permits: {
    id: string;
    title: string;
    type: string;
    typeLabel: string;
    status: string;
  }[];
  inspections: {
    id: string;
    title: string;
    status: string;
    module: string | null;
  }[];
  total: number;
}

/**
 * Run the cross-entity search. All queries run in parallel; the per-type
 * limits keep the payload small enough to bring back to the phone.
 *
 * `modulesField` is the raw string from the session (JSON array or null);
 * `null` means full-access internal staff. Every module gate is checked at
 * the field level too, not just at the caller — so misconfigured module
 * strings can't leak scoped data.
 */
export async function mobileSearch(
  projectId: string,
  query: string,
  modulesField: string | null | undefined,
): Promise<MobileSearchResult> {
  const q = query.trim();
  if (q.length < 2) return emptyResult();

  const scoped = isScopedUser(modulesField);
  const scopedModule = scoped ? primaryModuleFor(modulesField) : null;

  const canQAQC = canAccessModule(modulesField, MODULES.QAQC);
  const canSAFETY = canAccessModule(modulesField, MODULES.SAFETY);
  const canCONCERN = canAccessModule(modulesField, MODULES.CONCERN);
  const canHINDRANCE = canAccessModule(modulesField, MODULES.HINDRANCE);
  const canPERMIT = canAccessModule(modulesField, MODULES.PERMIT);
  const canPROGRESS = canAccessModule(modulesField, MODULES.PROGRESS);

  // WBS numeric-search shortcut — if the query looks like a villa number
  // (V15, Villa 15, 15), pull activities on that villa first. Otherwise
  // fall back to a name / taskCode contains. WBSNode has villaId as a bare
  // foreign key (no `villa` relation declared), so numeric matches resolve
  // via a two-step lookup: villa number → villaId → wbsNodes.
  const villaMatch = q.match(/^(?:v(?:illa)?\s*)?(\d{1,3})$/i);
  const villaIdsForNumericQuery = villaMatch
    ? await prisma.villa
        .findMany({
          where: { projectId, number: parseInt(villaMatch[1], 10) },
          select: { id: true },
        })
        .then((rows) => rows.map((r) => r.id))
    : [];

  const activitiesPromise = canPROGRESS
    ? prisma.wBSNode.findMany({
        where: villaMatch
          ? {
              projectId,
              villaId: { in: villaIdsForNumericQuery.length > 0 ? villaIdsForNumericQuery : ["__none__"] },
              // Leaves only — parent WBS rows don't have progressEntered
              // and would clutter results.
              children: { none: {} },
            }
          : {
              projectId,
              children: { none: {} },
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { taskCode: { contains: q, mode: "insensitive" } },
              ],
            },
        take: PER_TYPE_LIMIT,
        orderBy: [{ villaId: "asc" }, { orderIndex: "asc" }],
        select: {
          id: true,
          name: true,
          taskCode: true,
          villaId: true,
          sectionId: true,
        },
      })
    : Promise.resolve([]);

  const snagsPromise =
    canQAQC || canSAFETY
      ? prisma.issue.findMany({
          where: {
            projectId,
            deletedAt: null,
            description: { contains: q, mode: "insensitive" },
            ...(scopedModule ? { module: scopedModule } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: PER_TYPE_LIMIT,
          select: {
            id: true,
            description: true,
            severity: true,
            status: true,
            module: true,
          },
        })
      : Promise.resolve([]);

  const concernsPromise = canCONCERN
    ? prisma.concern.findMany({
        where: {
          projectId,
          deletedAt: null,
          description: { contains: q, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE_LIMIT,
        select: { id: true, description: true, status: true },
      })
    : Promise.resolve([]);

  const hindrancesPromise = canHINDRANCE
    ? prisma.hindrance.findMany({
        where: {
          projectId,
          deletedAt: null,
          description: { contains: q, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE_LIMIT,
        select: { id: true, description: true, status: true },
      })
    : Promise.resolve([]);

  const permitsPromise = canPERMIT
    ? prisma.workPermit.findMany({
        where: {
          projectId,
          deletedAt: null,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE_LIMIT,
        select: { id: true, title: true, type: true, status: true },
      })
    : Promise.resolve([]);

  const inspectionsPromise =
    canQAQC || canSAFETY
      ? prisma.inspection.findMany({
          where: {
            projectId,
            deletedAt: null,
            title: { contains: q, mode: "insensitive" },
            ...(scopedModule ? { module: scopedModule } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: PER_TYPE_LIMIT,
          select: { id: true, title: true, status: true, module: true },
        })
      : Promise.resolve([]);

  const [activities, snags, concerns, hindrances, permits, inspections] =
    await Promise.all([
      activitiesPromise,
      snagsPromise,
      concernsPromise,
      hindrancesPromise,
      permitsPromise,
      inspectionsPromise,
    ]);

  // Enrich activity rows with villa label + block code + section name via a
  // second batched query — the WBSNode model exposes only bare FK columns,
  // so we hydrate the labels ourselves. Skipped when no activities matched.
  const villaIds = Array.from(
    new Set(activities.map((a) => a.villaId).filter((v): v is string => !!v)),
  );
  const sectionIds = Array.from(
    new Set(activities.map((a) => a.sectionId).filter((v): v is string => !!v)),
  );
  const [villaRows, sectionRows] = await Promise.all([
    villaIds.length > 0
      ? prisma.villa.findMany({
          where: { id: { in: villaIds } },
          select: { id: true, label: true, number: true, block: { select: { code: true } } },
        })
      : Promise.resolve([]),
    sectionIds.length > 0
      ? prisma.milestoneSection.findMany({
          where: { id: { in: sectionIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const villaById = new Map(villaRows.map((v) => [v.id, v]));
  const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

  // Belt-and-braces module scope on issue/inspection rows — the module
  // filter above narrows for scoped users, but a full-access user shouldn't
  // see rows they can't legally access either (defence in depth).
  const snagsSafe = snags.filter((s) => canAccessScopedRow(modulesField, s.module));
  const inspectionsSafe = inspections.filter((i) =>
    canAccessScopedRow(modulesField, i.module),
  );

  const result: MobileSearchResult = {
    activities: activities.map((a) => {
      const villa = a.villaId ? villaById.get(a.villaId) : undefined;
      const section = a.sectionId ? sectionById.get(a.sectionId) : undefined;
      return {
        id: a.id,
        name: a.name,
        taskCode: a.taskCode,
        villaLabel: villa?.label ?? (villa?.number != null ? `Villa ${villa.number}` : null),
        blockCode: villa?.block?.code ?? null,
        sectionName: section?.name ?? null,
      };
    }),
    snags: snagsSafe.map((s) => ({
      id: s.id,
      description: s.description,
      severity: s.severity,
      status: s.status,
    })),
    concerns: concerns.map((c) => ({ id: c.id, description: c.description, status: c.status })),
    hindrances: hindrances.map((h) => ({ id: h.id, description: h.description, status: h.status })),
    permits: permits.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      typeLabel: WORK_PERMIT_TYPE_LABELS[p.type as WorkPermitType] ?? p.type,
      status: p.status,
    })),
    inspections: inspectionsSafe.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      module: i.module,
    })),
    total: 0,
  };
  result.total =
    result.activities.length +
    result.snags.length +
    result.concerns.length +
    result.hindrances.length +
    result.permits.length +
    result.inspections.length;
  return result;
}

function emptyResult(): MobileSearchResult {
  return {
    activities: [],
    snags: [],
    concerns: [],
    hindrances: [],
    permits: [],
    inspections: [],
    total: 0,
  };
}
