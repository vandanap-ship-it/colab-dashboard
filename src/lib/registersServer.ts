import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULES } from "@/lib/modules";
import { istDayString } from "@/lib/istDay";
import { recordAudit } from "@/lib/audit";
import {
  addDays,
  compareIdentifiers,
  isIsoDay,
  isoDayToDate,
  isSignOffDue,
  parseColumns,
  parseValues,
  type RegisterColumn,
  type RegisterValues,
} from "@/lib/registers";

/**
 * Server-side register helpers shared by the API routes, the mobile +
 * desktop pages and the due-date cron. Pure validation lives in
 * src/lib/registers.ts so client components can reuse it.
 */

export type LoadedRegisterType = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  module: string;
  columns: RegisterColumn[];
  identifierKey: string;
  dueDateKey: string | null;
  lastInspectedKey: string | null;
  defaultIntervalDays: number | null;
  signOffIntervalDays: number | null;
  inspectionTemplateCode: string | null;
  preparedByLabel: string | null;
  approvedByLabel: string | null;
};

type RegisterTypeRow = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  module: string;
  columns: unknown;
  identifierKey: string;
  dueDateKey: string | null;
  lastInspectedKey: string | null;
  defaultIntervalDays: number | null;
  signOffIntervalDays: number | null;
  inspectionTemplateCode: string | null;
  preparedByLabel: string | null;
  approvedByLabel: string | null;
};

export function toLoadedType(t: RegisterTypeRow): LoadedRegisterType {
  return { ...t, columns: parseColumns(t.columns) };
}

/** Active register types, in display order. */
export async function listRegisterTypes(): Promise<LoadedRegisterType[]> {
  const rows = await prisma.registerType.findMany({
    where: { active: true },
    orderBy: [{ orderIndex: "asc" }, { code: "asc" }],
  });
  return rows.map(toLoadedType);
}

export async function getRegisterType(code: string): Promise<LoadedRegisterType | null> {
  const t = await prisma.registerType.findUnique({ where: { code } });
  if (!t || !t.active) return null;
  return toLoadedType(t);
}

/**
 * The project's live register for a type, created on first touch. Lazy
 * creation keeps new projects + new register types zero-setup.
 */
export async function ensureRegister(projectId: string, typeId: string) {
  return prisma.register.upsert({
    where: { projectId_typeId: { projectId, typeId } },
    update: {},
    create: { projectId, typeId },
  });
}

/** Read-only lookup — doesn't create the register (for GET paths). */
export async function findRegister(projectId: string, typeId: string) {
  return prisma.register.findUnique({
    where: { projectId_typeId: { projectId, typeId } },
  });
}

export const rowInclude = {
  villa: { select: { id: true, number: true, label: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} as const;

type RowWithIncludes = Prisma.RegisterRowGetPayload<{ include: typeof rowInclude }>;

export type RegisterRowDto = {
  id: string;
  identifier: string;
  values: RegisterValues;
  villaId: string | null;
  villaLabel: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  firstSubmittedAt: string | null;
  lastInspectionId: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

export function villaLabel(v: { number: number; label: string | null } | null): string | null {
  if (!v) return null;
  return v.label ?? `Villa ${v.number}`;
}

export function toRowDto(r: RowWithIncludes): RegisterRowDto {
  return {
    id: r.id,
    identifier: r.identifier,
    values: parseValues(r.values),
    villaId: r.villaId,
    villaLabel: villaLabel(r.villa),
    retiredAt: r.retiredAt?.toISOString() ?? null,
    retiredReason: r.retiredReason,
    firstSubmittedAt: r.firstSubmittedAt?.toISOString() ?? null,
    lastInspectionId: r.lastInspectionId,
    updatedAt: r.updatedAt.toISOString(),
    updatedByName: r.updatedBy?.name ?? null,
  };
}

/** All non-deleted rows (live + retired), natural-sorted by identifier. */
export async function loadRows(registerId: string): Promise<RegisterRowDto[]> {
  const rows = await prisma.registerRow.findMany({
    where: { registerId, deletedAt: null },
    include: rowInclude,
  });
  return rows
    .map(toRowDto)
    .sort((a, b) => compareIdentifiers(a.identifier, b.identifier));
}

/** nextDueDate column value for a row's values, or null. */
export function dueDateFor(type: LoadedRegisterType, values: RegisterValues): Date | null {
  if (!type.dueDateKey) return null;
  const v = values[type.dueDateKey];
  return v && isIsoDay(v) ? isoDayToDate(v) : null;
}

/**
 * Users who decide register sign-offs — the same set that approves
 * Safety Inductions and HSE checklists: PLANNER / SITE_MANAGER with the
 * module. On Amanvana that's Girish R only (permit_notification_routing).
 */
export async function findRegisterApprovers(module: string, excludeUserId?: string) {
  return prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["PLANNER", "SITE_MANAGER"] },
      modules: { contains: `"${module || MODULES.SAFETY}"` },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/**
 * People who keep a register up to date: whoever touched a live row plus
 * whoever prepared the most recent sign-off. Used for "due soon" and
 * "sign-off due" pushes, so the reminder goes to the person doing the
 * work rather than a role guess. Inactive users and the register's
 * approvers are dropped — an approved checklist stamps the approver as a
 * row's last editor, but Girish should only hear about overdue items.
 */
export async function findRegisterMaintainers(registerId: string, module: string): Promise<string[]> {
  const [rows, lastSub] = await Promise.all([
    prisma.registerRow.findMany({
      where: { registerId, deletedAt: null, retiredAt: null },
      select: { createdById: true, updatedById: true },
    }),
    prisma.registerSubmission.findFirst({
      where: { registerId },
      orderBy: { createdAt: "desc" },
      select: { preparedById: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.createdById);
    ids.add(r.updatedById);
  }
  if (lastSub) ids.add(lastSub.preparedById);
  if (ids.size === 0) return [];
  const [active, approvers] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: Array.from(ids) }, active: true }, select: { id: true } }),
    findRegisterApprovers(module),
  ]);
  const approverIds = new Set(approvers.map((a) => a.id));
  return active.map((u) => u.id).filter((id) => !approverIds.has(id));
}

/**
 * Called when an inspection is PASSED. If it's linked to a register row
 * (e.g. a CL-SAF-03 Fire Extinguishers checklist for FE-07), roll that
 * row's last-inspected date to the inspection's IST day and its due date
 * forward by the type's interval. Never moves dates backwards — an old
 * inspection approved late doesn't undo a newer manual entry.
 *
 * Returns a short summary for the caller's logs, or null when nothing
 * changed.
 */
export async function applyPassedInspectionToRegister(
  inspection: { id: string; registerRowId: string | null; createdAt: Date; projectId: string },
  actorUserId: string,
): Promise<string | null> {
  if (!inspection.registerRowId) return null;
  const row = await prisma.registerRow.findUnique({
    where: { id: inspection.registerRowId },
    include: { register: { include: { type: true } } },
  });
  if (!row || row.deletedAt) return null;
  if (row.register.projectId !== inspection.projectId) return null;
  const type = toLoadedType(row.register.type);
  if (!type.lastInspectedKey) return null;

  const values = parseValues(row.values);
  const inspectedOn = istDayString(inspection.createdAt);
  const currentLast = values[type.lastInspectedKey];
  if (currentLast && isIsoDay(currentLast) && currentLast >= inspectedOn) return null;

  const next: RegisterValues = { ...values, [type.lastInspectedKey]: inspectedOn };
  if (type.dueDateKey && type.defaultIntervalDays) {
    next[type.dueDateKey] = addDays(inspectedOn, type.defaultIntervalDays);
  }
  const nextDueDate = dueDateFor(type, next);

  await prisma.registerRow.update({
    where: { id: row.id },
    data: {
      values: next,
      nextDueDate,
      lastInspectionId: inspection.id,
      updatedById: actorUserId,
      dueSoonNotifiedAt: null,
      overdueNotifiedAt: null,
    },
  });
  const summary = `${type.shortName} ${row.identifier}: last inspected → ${inspectedOn}${
    type.dueDateKey && next[type.dueDateKey] ? `, next due → ${next[type.dueDateKey]}` : ""
  } (from approved checklist)`;
  await recordAudit({
    projectId: inspection.projectId,
    userId: actorUserId,
    action: "UPDATE",
    entityType: "RegisterRow",
    entityId: row.id,
    summary,
  });
  return summary;
}

/**
 * Cross-project guard for Inspection.registerRowId — same shape as
 * assertWbsNodeInProject. Returns an error string, or null when the row
 * is a live (not retired / deleted) row on this project's register.
 */
export async function assertRegisterRowInProject(
  registerRowId: string | null | undefined,
  projectId: string,
): Promise<string | null> {
  if (!registerRowId) return null;
  const row = await prisma.registerRow.findUnique({
    where: { id: registerRowId },
    select: { deletedAt: true, retiredAt: true, register: { select: { projectId: true } } },
  });
  if (!row || row.deletedAt || row.register.projectId !== projectId) {
    return "That register item isn't on this project";
  }
  if (row.retiredAt) return "That register item has been retired";
  return null;
}

/**
 * Everything the register screen (mobile + desktop) needs in one call:
 * rows, the pending sign-off (if any), the last approved one, whether
 * the monthly sign-off is due, the villa list for the picker and the
 * linked checklist template's id.
 */
export async function loadRegisterOverview(projectId: string, type: LoadedRegisterType) {
  const register = await findRegister(projectId, type.id);
  const [rows, pending, lastApproved, latestLive, villas, template] = await Promise.all([
    register ? loadRows(register.id) : Promise.resolve([] as RegisterRowDto[]),
    register
      ? prisma.registerSubmission.findFirst({
          where: { registerId: register.id, status: "PENDING" },
          select: { id: true, displayId: true },
        })
      : null,
    register
      ? prisma.registerSubmission.findFirst({
          where: { registerId: register.id, status: "APPROVED" },
          orderBy: { approvedAt: "desc" },
          select: { id: true, displayId: true, approvedAt: true, asOfDate: true },
        })
      : null,
    register
      ? prisma.registerSubmission.findFirst({
          where: { registerId: register.id, status: { in: ["PENDING", "APPROVED"] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : null,
    prisma.villa.findMany({
      where: { projectId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, label: true },
    }),
    type.inspectionTemplateCode
      ? prisma.inspectionTemplate.findUnique({
          where: { code: type.inspectionTemplateCode },
          select: { id: true, active: true },
        })
      : null,
  ]);
  const liveCount = rows.filter((r) => !r.retiredAt).length;
  const signOffDue = isSignOffDue(latestLive?.createdAt ?? null, type.signOffIntervalDays, new Date(), liveCount);
  return {
    register,
    rows,
    pending,
    lastApproved,
    signOffDue,
    villas: villas.map((v) => ({ id: v.id, label: villaLabel(v) ?? `Villa ${v.number}` })),
    inspectionTemplateId: template?.active ? template.id : null,
  };
}
