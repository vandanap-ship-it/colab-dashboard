import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { readIdempotencyKey } from "@/lib/idempotency";
import { recordAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push";
import { istDayString } from "@/lib/istDay";
import { badRequest, forbidden, notFound, unauthorized, handleApiError } from "@/lib/apiErrors";
import {
  formatIsoDay,
  generateSubmissionDisplayId,
  isIsoDay,
  isoDayToDate,
  validateRowValues,
  type RegisterSnapshot,
} from "@/lib/registers";
import {
  ensureRegister,
  findRegister,
  findRegisterApprovers,
  getRegisterType,
  loadRows,
} from "@/lib/registersServer";

/**
 * Monthly sign-offs for one project register.
 *
 * GET  → sign-off history, newest first.
 * POST → freeze the live rows into a new PENDING sign-off and ping the
 *        approver (Girish — PLANNER/SITE_MANAGER with the module). Only
 *        one PENDING sign-off per register at a time.
 */

const PostSubmissionSchema = z.object({
  asOfDate: z.string().optional(), // YYYY-MM-DD; defaults to today (IST)
  remark: z.string().max(2000).nullable().optional(),
  idempotencyKey: z.string().max(120).optional(),
});

type Ctx = { params: Promise<{ id: string; code: string }> };

const submissionSelect = {
  id: true,
  displayId: true,
  asOfDate: true,
  rowCount: true,
  status: true,
  remark: true,
  createdAt: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  preparedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
} as const;

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: projectId, code } = await ctx.params;
    const type = await getRegisterType(code);
    if (!type) return notFound("Register type not found");
    if (!canAccessModule(session.user.modules, type.module as ModuleKey)) return forbidden();

    const register = await findRegister(projectId, type.id);
    const submissions = register
      ? await prisma.registerSubmission.findMany({
          where: { registerId: register.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: submissionSelect,
        })
      : [];
    return NextResponse.json({ submissions });
  } catch (e) {
    return handleApiError(e, "registers/[code]/submissions GET");
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

    const parsed = await parseBody(req, PostSubmissionSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) return notFound("Project not found");

    const today = istDayString();
    const asOf = body.asOfDate?.trim() || today;
    if (!isIsoDay(asOf)) return badRequest("Sign-off date must be a valid date");
    if (asOf > today) return badRequest("Sign-off date can't be in the future");

    const register = await ensureRegister(projectId, type.id);
    const idempotencyKey = readIdempotencyKey(body);
    if (idempotencyKey) {
      const replay = await prisma.registerSubmission.findUnique({
        where: { idempotencyKey },
        select: submissionSelect,
      });
      if (replay) return NextResponse.json({ submission: replay }, { status: 200 });
    }

    const pending = await prisma.registerSubmission.findFirst({
      where: { registerId: register.id, status: "PENDING" },
      select: { displayId: true },
    });
    if (pending) {
      return badRequest(`${pending.displayId} is still waiting for sign-off. It has to be approved or rejected first.`);
    }

    const live = (await loadRows(register.id)).filter((r) => !r.retiredAt);
    if (live.length === 0) return badRequest("Add at least one item before submitting for sign-off.");

    // Re-validate against the current column schema — a column may have
    // become required since a row was saved.
    const incomplete = live.filter((r) => !validateRowValues(type.columns, r.values, type).ok);
    if (incomplete.length > 0) {
      return NextResponse.json(
        {
          error: `${incomplete.length} item${incomplete.length === 1 ? " has" : "s have"} missing or invalid fields: ${incomplete
            .slice(0, 5)
            .map((r) => r.identifier)
            .join(", ")}${incomplete.length > 5 ? "…" : ""}. Fix ${incomplete.length === 1 ? "it" : "them"} first.`,
          incompleteRowIds: incomplete.map((r) => r.id),
        },
        { status: 400 },
      );
    }

    const snapshot: RegisterSnapshot = {
      version: 1,
      typeCode: type.code,
      typeName: type.name,
      projectName: project.name,
      columns: type.columns,
      identifierKey: type.identifierKey,
      preparedByLabel: type.preparedByLabel,
      approvedByLabel: type.approvedByLabel,
      rows: live.map((r) => ({
        id: r.id,
        identifier: r.identifier,
        values: r.values,
        villaLabel: r.villaLabel,
      })),
    };

    const now = new Date();
    const submission = await prisma.$transaction(async (tx) => {
      const created = await tx.registerSubmission.create({
        data: {
          registerId: register.id,
          displayId: generateSubmissionDisplayId(),
          asOfDate: isoDayToDate(asOf),
          snapshot,
          rowCount: live.length,
          remark: body.remark?.trim() || null,
          preparedById: session.user.id,
          idempotencyKey,
        },
        select: submissionSelect,
      });
      await tx.registerRow.updateMany({
        where: { id: { in: live.map((r) => r.id) }, firstSubmittedAt: null },
        data: { firstSubmittedAt: now },
      });
      await tx.register.update({ where: { id: register.id }, data: { signOffNudgedAt: null } });
      return created;
    });
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "RegisterSubmission",
      entityId: submission.id,
      summary: `${type.shortName} register submitted for sign-off: ${submission.displayId} (${live.length} items, as of ${asOf})`,
    });

    // Awaited — see notifications_await_fix.
    const approvers = await findRegisterApprovers(type.module, session.user.id);
    await Promise.allSettled(
      approvers.map((a) =>
        sendPushToUser(a.id, {
          title: `${type.shortName} register awaiting your sign-off`,
          body: `${submission.displayId} · ${live.length} item${live.length === 1 ? "" : "s"} as of ${formatIsoDay(asOf)}. Tap to review.`,
          url: `/mobile/${projectId}/registers/${type.code}/submissions/${submission.id}`,
          tag: `register-sub-${submission.id}`,
        }),
      ),
    );

    return NextResponse.json({ submission }, { status: 201 });
  } catch (e) {
    return handleApiError(e, "registers/[code]/submissions POST");
  }
}
