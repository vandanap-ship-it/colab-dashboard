import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { recordAudit } from "@/lib/audit";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";
import { normaliseIdentifier, validateRowValues } from "@/lib/registers";
import {
  dueDateFor,
  ensureRegister,
  findRegister,
  getRegisterType,
  loadRows,
  rowInclude,
  toRowDto,
} from "@/lib/registersServer";

/**
 * Register rows for one project + register type (e.g. the Amanvana fire
 * extinguisher list).
 *
 * GET  → every non-deleted row (live + retired), natural-sorted.
 * POST → add a row. Values are validated against the type's column
 *        schema; the identifier must be unique among the register's
 *        non-deleted rows (case/whitespace-insensitive).
 *
 * Gate: the register type's module (SAFETY for fire extinguishers). Any
 * user with the module can maintain the list; sign-off is where the
 * approver gate lives (register-submissions/[id]).
 */

const PostRowSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number()])),
  villaId: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().max(120).optional(),
});

type Ctx = { params: Promise<{ id: string; code: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: projectId, code } = await ctx.params;
    const type = await getRegisterType(code);
    if (!type) return notFound("Register type not found");
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) return forbidden();

    const register = await findRegister(projectId, type.id);
    const rows = register ? await loadRows(register.id) : [];
    return NextResponse.json({ type, rows });
  } catch (e) {
    return handleApiError(e, "registers/[code]/rows GET");
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: projectId, code } = await ctx.params;
    const type = await getRegisterType(code);
    if (!type) return notFound("Register type not found");
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) {
      return forbidden(`Your account doesn't have access to the ${type.shortName} register.`);
    }

    const parsed = await parseBody(req, PostRowSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return notFound("Project not found");

    const result = validateRowValues(type.columns, body.values, type);
    if (!result.ok) {
      return NextResponse.json({ error: "Some fields need fixing", fieldErrors: result.errors }, { status: 400 });
    }
    const values = result.values;
    const identifier = values[type.identifierKey];
    if (!identifier) return badRequest("Identifier is required");

    if (body.villaId) {
      const villa = await prisma.villa.findUnique({ where: { id: body.villaId }, select: { projectId: true } });
      if (!villa || villa.projectId !== projectId) return badRequest("Villa is not on this project");
    }

    const register = await ensureRegister(projectId, type.id);
    const idempotencyKey = readIdempotencyKey(body);
    const identifierNorm = normaliseIdentifier(identifier);

    // Uniqueness among non-deleted rows. Checked before the idempotent
    // create; a replay of the same key short-circuits to the existing row
    // inside createIdempotent, so look that up first to avoid a false
    // "already exists" on replays.
    if (idempotencyKey) {
      const replay = await prisma.registerRow.findUnique({ where: { idempotencyKey }, include: rowInclude });
      if (replay) return NextResponse.json({ row: toRowDto(replay) }, { status: 200 });
    }
    const clash = await prisma.registerRow.findFirst({
      where: { registerId: register.id, identifierNorm, deletedAt: null },
      select: { id: true, retiredAt: true },
    });
    if (clash) {
      return NextResponse.json(
        {
          error: clash.retiredAt
            ? `${identifier} is already on the list as a retired item. Restore it instead of adding it again.`
            : `${identifier} is already on the list.`,
          fieldErrors: { [type.identifierKey]: "Already on the list" },
        },
        { status: 400 },
      );
    }

    const maxOrder = await prisma.registerRow.aggregate({
      where: { registerId: register.id },
      _max: { orderIndex: true },
    });

    const { record, duplicate } = await createIdempotent(
      idempotencyKey,
      () => prisma.registerRow.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: rowInclude }),
      () =>
        prisma.registerRow.create({
          data: {
            registerId: register.id,
            values,
            identifier,
            identifierNorm,
            nextDueDate: dueDateFor(type, values),
            villaId: body.villaId ?? null,
            orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
            createdById: session.user.id,
            updatedById: session.user.id,
            idempotencyKey,
          },
          include: rowInclude,
        }),
    );

    if (!duplicate) {
      await recordAudit({
        projectId,
        userId: session.user.id,
        action: "CREATE",
        entityType: "RegisterRow",
        entityId: record.id,
        summary: `${type.shortName}: added ${identifier}`,
      });
    }

    return NextResponse.json({ row: toRowDto(record) }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    return handleApiError(e, "registers/[code]/rows POST");
  }
}
