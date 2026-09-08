import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody, zDateString } from "@/lib/parseBody";
import { assertWbsNodeInProject } from "@/lib/projectFkGuards";
import { assignmentEmail, sendEmail } from "@/lib/email";
import {
  WORK_PERMIT_TYPES,
  WORK_PERMIT_TYPE_LABELS,
  isValidHhMm,
  serializeApproverIds,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

const PostWorkPermitSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(WORK_PERMIT_TYPES),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  workDate: zDateString,
  startTime: z.string().refine(isValidHhMm, "startTime must be HH:MM 24-hour"),
  endTime: z.string().refine(isValidHhMm, "endTime must be HH:MM 24-hour"),
  location: z.string().max(200).optional(),
  contractorId: z.string().min(1).nullable().optional(),
  wbsNodeId: z.string().min(1).nullable().optional(),
  approverIds: z.array(z.string().min(1)).min(1).max(10),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const workPermitInclude = {
  requester: { select: { id: true, name: true, username: true } },
  approver: { select: { id: true, name: true, username: true } },
  closer: { select: { id: true, name: true, username: true } },
  contractor: { select: { id: true, name: true } },
  wbsNode: { select: { id: true, name: true, taskCode: true } },
  photos: { select: { id: true, url: true } },
} as const;

const STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CLOSED"] as WorkPermitStatus[]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
    return NextResponse.json({ error: "Your account doesn't have access to permits." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const mine = searchParams.get("mine"); // "requester" | "approver" | null
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: Record<string, unknown> = { projectId, deletedAt: null };
  if (status && STATUSES.has(status as WorkPermitStatus)) where.status = status;
  if (mine === "requester") {
    where.requesterId = session.user.id;
  } else if (mine === "approver") {
    // Postgres JSON string contains — the approverIds column is a JSON string
    // array like `["u1","u2"]`, so we can substring-match on the user's id
    // wrapped in quotes. Not the cleanest possible query (a proper JSONB
    // column would be better) but avoids a schema migration and is plenty
    // fast for the volumes we see.
    where.approverIds = { contains: `"${session.user.id}"` };
    where.status = where.status ?? "PENDING";
  }

  const workPermits = await prisma.workPermit.findMany({
    where,
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    include: workPermitInclude,
  });

  // Status counts for the tab pills.
  const grouped = await prisma.workPermit.groupBy({
    by: ["status"],
    where: { projectId, deletedAt: null },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, CLOSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ workPermits, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
    return NextResponse.json({ error: "Your account doesn't have access to permits." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostWorkPermitSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Cross-project FK guard on the activity link. Contractor is separately
  // checked below because we also need to confirm it exists AND belongs to
  // this project.
  const wbsErr = await assertWbsNodeInProject(body.wbsNodeId, body.projectId);
  if (wbsErr) return NextResponse.json({ error: wbsErr }, { status: 400 });

  if (body.contractorId) {
    const c = await prisma.contractor.findFirst({
      where: { id: body.contractorId, projectId: body.projectId },
      select: { id: true },
    });
    if (!c) {
      return NextResponse.json(
        { error: "Contractor does not belong to this project" },
        { status: 400 },
      );
    }
  }

  // Every approver must be an active user. Fail loud if the client sends a
  // stale id — a Pending permit assigned to a deleted user would never
  // resolve.
  const approvers = await prisma.user.findMany({
    where: { id: { in: body.approverIds }, active: true },
    select: { id: true },
  });
  if (approvers.length !== body.approverIds.length) {
    return NextResponse.json(
      { error: "One or more approvers are inactive or don't exist" },
      { status: 400 },
    );
  }

  const idempotencyKey = readIdempotencyKey(body);
  const photos = (body.photoUrls ?? []).slice(0, 6);

  const { record: workPermit, duplicate } = await createIdempotent(
    idempotencyKey,
    () =>
      prisma.workPermit.findUnique({
        where: { idempotencyKey: idempotencyKey! },
        include: workPermitInclude,
      }),
    () =>
      prisma.workPermit.create({
        data: {
          projectId: body.projectId,
          type: body.type,
          title: body.title.trim(),
          description: body.description?.trim() || null,
          workDate: new Date(body.workDate),
          startTime: body.startTime,
          endTime: body.endTime,
          location: body.location?.trim() || null,
          contractorId: body.contractorId || null,
          wbsNodeId: body.wbsNodeId || null,
          requesterId: session.user.id,
          approverIds: serializeApproverIds(body.approverIds),
          status: "PENDING",
          idempotencyKey,
          photos:
            photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: workPermitInclude,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId: body.projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "WorkPermit",
      entityId: workPermit.id,
      summary: `Work permit raised: ${workPermit.type} · ${workPermit.title}`,
    });

    // Approver notification emails. Fire-and-forget after DB commit — silent
    // no-op when a candidate has no email on file or RESEND_API_KEY isn't
    // set on the deploy. Batched by Promise.allSettled so one bad address
    // doesn't skip the rest.
    const approverRecipients = await prisma.user.findMany({
      where: { id: { in: body.approverIds }, email: { not: null } },
      select: { name: true, email: true },
    });
    const permitUrl = `${SIDDHI_BASE_URL}/mobile/${body.projectId}/permit`;
    await Promise.allSettled(
      approverRecipients.map((u) =>
        sendEmail(
          assignmentEmail({
            to: u.email!,
            assigneeName: u.name,
            itemType: "Work Permit",
            itemTitle: `${WORK_PERMIT_TYPE_LABELS[workPermit.type as WorkPermitType] ?? workPermit.type} — ${workPermit.title}`,
            itemUrl: permitUrl,
            raisedByName: workPermit.requester?.name,
            dueDate: workPermit.workDate,
          }),
        ),
      ),
    );
  }

  return NextResponse.json({ workPermit }, { status: duplicate ? 200 : 201 });
}
