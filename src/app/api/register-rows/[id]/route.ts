import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { checkConflict } from "@/lib/optimisticLock";
import { recordAudit, diffSummary } from "@/lib/audit";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";
import { normaliseIdentifier, parseValues, validateRowValues } from "@/lib/registers";
import { dueDateFor, rowInclude, toLoadedType, toRowDto } from "@/lib/registersServer";

/**
 * One register row (one fire extinguisher).
 *
 * PATCH { action: "update", values, villaId } → edit fields
 * PATCH { action: "retire", retiredReason }   → taken off site; kept for history
 * PATCH { action: "restore" }                 → back on the live list
 * DELETE                                      → only for rows never frozen into
 *                                               a sign-off (typos). Anything
 *                                               signed off must be retired.
 *
 * Gate: the register type's module. Edits after a sign-off are fine —
 * the sign-off's snapshot is frozen and doesn't move.
 */

const PatchRowSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    values: z.record(z.string(), z.union([z.string(), z.number()])),
    villaId: z.string().min(1).nullable().optional(),
    expectedUpdatedAt: z.string().optional(),
  }),
  z.object({
    action: z.literal("retire"),
    retiredReason: z.string().trim().min(3, "Say why it's being retired").max(500),
    expectedUpdatedAt: z.string().optional(),
  }),
  z.object({
    action: z.literal("restore"),
    expectedUpdatedAt: z.string().optional(),
  }),
]);

type Ctx = { params: Promise<{ id: string }> };

async function loadRow(id: string) {
  return prisma.registerRow.findUnique({
    where: { id },
    include: { ...rowInclude, register: { include: { type: true } } },
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id } = await ctx.params;

    const before = await loadRow(id);
    if (!before || before.deletedAt) return notFound();
    const type = toLoadedType(before.register.type);
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) return forbidden();

    const parsed = await parseBody(req, PatchRowSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const conflict = checkConflict(body.expectedUpdatedAt, before.updatedAt, { id: before.id });
    if (!conflict.ok) return conflict.response!;

    const projectId = before.register.projectId;

    if (body.action === "retire") {
      if (before.retiredAt) return badRequest(`${before.identifier} is already retired.`);
      const updated = await prisma.registerRow.update({
        where: { id },
        data: { retiredAt: new Date(), retiredReason: body.retiredReason, updatedById: session.user.id },
        include: rowInclude,
      });
      await recordAudit({
        projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "RegisterRow",
        entityId: id,
        summary: `${type.shortName}: retired ${before.identifier} (${body.retiredReason.slice(0, 80)})`,
      });
      return NextResponse.json({ row: toRowDto(updated) });
    }

    if (body.action === "restore") {
      if (!before.retiredAt) return badRequest(`${before.identifier} isn't retired.`);
      // A new row may have taken the identifier while this one was retired.
      const clash = await prisma.registerRow.findFirst({
        where: {
          registerId: before.registerId,
          identifierNorm: before.identifierNorm,
          deletedAt: null,
          id: { not: id },
        },
        select: { id: true },
      });
      if (clash) return badRequest(`Another item is already using ${before.identifier}.`);
      const updated = await prisma.registerRow.update({
        where: { id },
        data: { retiredAt: null, retiredReason: null, updatedById: session.user.id },
        include: rowInclude,
      });
      await recordAudit({
        projectId,
        userId: session.user.id,
        action: "RESTORE",
        entityType: "RegisterRow",
        entityId: id,
        summary: `${type.shortName}: restored ${before.identifier} to the live list`,
      });
      return NextResponse.json({ row: toRowDto(updated) });
    }

    // update
    if (before.retiredAt) return badRequest("Restore this item before editing it.");
    const result = validateRowValues(type.columns, body.values, type);
    if (!result.ok) {
      return NextResponse.json({ error: "Some fields need fixing", fieldErrors: result.errors }, { status: 400 });
    }
    const values = result.values;
    const identifier = values[type.identifierKey];
    if (!identifier) return badRequest("Identifier is required");
    const identifierNorm = normaliseIdentifier(identifier);

    if (identifierNorm !== before.identifierNorm) {
      const clash = await prisma.registerRow.findFirst({
        where: { registerId: before.registerId, identifierNorm, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `${identifier} is already on the list.`, fieldErrors: { [type.identifierKey]: "Already on the list" } },
          { status: 400 },
        );
      }
    }

    const villaId = body.villaId === undefined ? before.villaId : body.villaId;
    if (villaId && villaId !== before.villaId) {
      const villa = await prisma.villa.findUnique({ where: { id: villaId }, select: { projectId: true } });
      if (!villa || villa.projectId !== projectId) return badRequest("Villa is not on this project");
    }

    const nextDueDate = dueDateFor(type, values);
    const dueChanged = (nextDueDate?.getTime() ?? null) !== (before.nextDueDate?.getTime() ?? null);
    const updated = await prisma.registerRow.update({
      where: { id },
      data: {
        values,
        identifier,
        identifierNorm,
        nextDueDate,
        villaId,
        updatedById: session.user.id,
        // A new due date gets its own reminders.
        ...(dueChanged ? { dueSoonNotifiedAt: null, overdueNotifiedAt: null } : {}),
      },
      include: rowInclude,
    });

    const diff = diffSummary(
      { ...parseValues(before.values), villaId: before.villaId },
      { ...values, villaId },
    );
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "RegisterRow",
      entityId: id,
      summary: `${type.shortName}: edited ${identifier}${diff.summary ? ` (${diff.summary})` : ""}`,
      changes: diff.changes,
    });
    return NextResponse.json({ row: toRowDto(updated) });
  } catch (e) {
    return handleApiError(e, "register-rows/[id] PATCH");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id } = await ctx.params;
    const row = await loadRow(id);
    if (!row || row.deletedAt) return notFound();
    const type = toLoadedType(row.register.type);
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) return forbidden();

    if (row.firstSubmittedAt) {
      return badRequest(
        `${row.identifier} is on a signed-off register, so it can't be deleted. Retire it instead.`,
      );
    }

    await prisma.registerRow.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: session.user.id },
    });
    await recordAudit({
      projectId: row.register.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "RegisterRow",
      entityId: id,
      summary: `${type.shortName}: deleted ${row.identifier} (never signed off)`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "register-rows/[id] DELETE");
  }
}
