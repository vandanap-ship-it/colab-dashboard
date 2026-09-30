import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody, zDateString } from "@/lib/parseBody";
import { assertWbsNodeInProject } from "@/lib/projectFkGuards";
import { sanitizeUploadUrls } from "@/lib/upload";
import { assignmentEmail, sendEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import {
  WORK_PERMIT_TYPES,
  WORK_PERMIT_TYPE_LABELS,
  isValidHhMm,
  serializeApproverIds,
  generatePermitDisplayId,
  type WorkPermitStatus,
  type WorkPermitType,
} from "@/lib/workPermit";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

// Colab-parity checklist response shape — one entry per template
// CHECKPOINT. `q` mirrors the template question at capture time so
// audit + backfill work even if the template later changes.
// `reviewerNote` and `reviewerPhotoUrl` are the Colab-parity Add-Reply
// fields; the raiser leaves them blank at create time and reviewers
// write via PATCH /api/work-permits/[id]/checkpoints.
const ChecklistResponseSchema = z.object({
  q: z.string().min(1).max(500),
  passed: z.boolean().nullable(),
  remark: z.string().max(1000).optional(),
  photoUrl: z.string().url().optional(),
  reviewerNote: z.string().max(2000).nullable().optional(),
  reviewerPhotoUrl: z.string().url().nullable().optional(),
});

// Colab-parity: Step-2 "Approval Levels" row. Each row is one user
// at one level with the two capability toggles ("Can Close" / "Can
// Suspend"). Legacy clients that only know `approverIds` continue to
// work — the POST handler synthesizes level-1 rows for them below.
const ApproverInputSchema = z.object({
  userId: z.string().min(1),
  levelIndex: z.number().int().min(1).max(10).default(1),
  levelName: z.string().max(60).optional(),
  canClose: z.boolean().default(true),
  canSuspend: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  orderIndex: z.number().int().min(0).max(20).default(0),
});

// Colab-parity: Step-2 "Labour" multi-row (Abhishek zip, screen 10).
// Every field is optional so a requester can enter just a headcount
// or just a crew leader — Colab does the same.
// `kind` splits the same row shape between the generic Labour section
// (LABOUR) and Night Work's "Details of Personnel in Attendance"
// (ATTENDANCE). Defaults to LABOUR for backward compatibility with the
// existing form payload.
const LabourEntryInputSchema = z.object({
  kind: z.enum(["LABOUR", "ATTENDANCE"]).default("LABOUR"),
  workerName: z.string().max(120).optional().nullable(),
  role: z.string().max(60).optional().nullable(),
  count: z.number().int().min(0).max(9999).optional().nullable(),
  orderIndex: z.number().int().min(0).max(50).default(0),
});

const PostWorkPermitSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(WORK_PERMIT_TYPES),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  workDate: zDateString,
  // Colab-parity Valid From / Valid To date range. Optional so older
  // clients that only send workDate keep working — the server defaults
  // endDate to workDate (same-day permit) when unset.
  endDate: zDateString.optional(),
  startTime: z.string().refine(isValidHhMm, "startTime must be HH:MM 24-hour"),
  endTime: z.string().refine(isValidHhMm, "endTime must be HH:MM 24-hour"),
  location: z.string().max(200).optional(),
  contractorId: z.string().min(1).nullable().optional(),
  wbsNodeId: z.string().min(1).nullable().optional(),
  // Legacy field — kept working for old builds. New form uses `approvers`
  // (per-level, with capabilities); at least one of the two is required.
  approverIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  approvers: z.array(ApproverInputSchema).min(1).max(20).optional(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  // Colab-parity: per-checkpoint responses. Optional so the existing
  // clients that don't yet send them keep working; new mobile builds
  // populate this from the WORK_PERMIT_CHECKPOINTS template.
  checklistResponses: z.array(ChecklistResponseSchema).max(50).optional(),
  // Colab-parity Step-2 additions.
  labourEntries: z.array(LabourEntryInputSchema).max(30).optional(),
  coRequesterIds: z.array(z.string().min(1)).max(20).optional(),
  activityHead: z.string().max(120).optional().nullable(),
  idempotencyKey: z.string().max(120).optional(),
});

const workPermitInclude = {
  requester: { select: { id: true, name: true, username: true } },
  approver: { select: { id: true, name: true, username: true } },
  closer: { select: { id: true, name: true, username: true } },
  contractor: { select: { id: true, name: true } },
  wbsNode: { select: { id: true, name: true, taskCode: true } },
  photos: { select: { id: true, url: true } },
  approvers: {
    orderBy: [{ levelIndex: "asc" }, { orderIndex: "asc" }],
    include: { user: { select: { id: true, name: true, username: true } } },
  },
  labourEntries: { orderBy: { orderIndex: "asc" } },
} satisfies Prisma.WorkPermitInclude;

const STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CLOSED", "SUSPENDED"] as WorkPermitStatus[]);

// A user can raise / see permits if their scope includes either PERMIT
// (contractors like Abraham T, tagged PERMIT) or SAFETY (WL HSE officers
// like Abhishek Mane, tagged SAFETY). The mobile form and detail pages
// have always gated on SAFETY; the API used to gate on PERMIT-only, so
// Abhishek could open the wizard but got a 403 on Submit. Widened
// 2026-09-30 to match the form gate.
function canUsePermits(mods: string | null | undefined): boolean {
  return (
    canAccessModule(mods, MODULES.PERMIT) ||
    canAccessModule(mods, MODULES.SAFETY)
  );
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUsePermits(session.user.modules)) {
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
  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, CLOSED: 0, SUSPENDED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ workPermits, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUsePermits(session.user.modules)) {
    return NextResponse.json({ error: "Your account doesn't have access to permits." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostWorkPermitSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Idempotency short-circuit · if the offline-queue replay carries a
  // key we've already committed, return the existing row without
  // re-running validation. A contractor deactivated between the
  // original write and the replay, or an approver going inactive,
  // would otherwise 400 on the retry even though the permit exists.
  const idempotencyKey = readIdempotencyKey(body);
  if (idempotencyKey) {
    const existing = await prisma.workPermit.findUnique({
      where: { idempotencyKey },
      include: workPermitInclude,
    });
    if (existing) {
      return NextResponse.json({ workPermit: existing }, { status: 200 });
    }
  }

  // Cross-project FK guard on the activity link. Contractor is separately
  // checked below because we also need to confirm it exists AND belongs to
  // this project.
  const wbsErr = await assertWbsNodeInProject(body.wbsNodeId, body.projectId);
  if (wbsErr) return NextResponse.json({ error: wbsErr }, { status: 400 });

  // Colab-parity Valid From / Valid To: end date must be on or after
  // start date. Same-day is fine (endDate === workDate) — that's the
  // default the server fills in for legacy single-day submissions. The
  // client-side form enforces the same rule, this is belt-and-braces so
  // a hand-crafted POST can't file an inverted window.
  if (body.endDate) {
    const start = new Date(body.workDate);
    const end = new Date(body.endDate);
    if (end.getTime() < start.getTime()) {
      return NextResponse.json(
        { error: "Valid To date can't be earlier than Valid From date." },
        { status: 400 },
      );
    }
  }

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

  // Normalize the two accepted shapes: legacy `approverIds` -> a single
  // level-1 row per user with default caps; new `approvers` used verbatim.
  // At least one must be provided.
  const rawApproverRows =
    body.approvers && body.approvers.length > 0
      ? body.approvers
      : (body.approverIds ?? []).map((userId, i) => ({
          userId,
          levelIndex: 1,
          levelName: undefined as string | undefined,
          canClose: true,
          canSuspend: false,
          isDefault: false,
          orderIndex: i,
        }));

  // Dedup by (userId, levelIndex) so a client that accidentally sent
  // the same approver twice at the same level doesn't blow up the
  // PermitApprover unique constraint at write time (@@unique
  // [workPermitId, userId, levelIndex]). Keep the LAST duplicate so the
  // latest capability choice wins.
  const approverRowMap = new Map<string, (typeof rawApproverRows)[number]>();
  for (const r of rawApproverRows) {
    approverRowMap.set(`${r.userId}:${r.levelIndex ?? 1}`, r);
  }
  const approverRows = Array.from(approverRowMap.values());

  if (approverRows.length === 0) {
    return NextResponse.json(
      { error: "At least one approver is required" },
      { status: 400 },
    );
  }

  // Every approver must be an active user. Fail loud if the client sends a
  // stale id — a Pending permit assigned to a deleted user would never
  // resolve.
  const approverUserIds = Array.from(new Set(approverRows.map((r) => r.userId)));

  // Colab-parity: the requester cannot be their own approver. The
  // mobile form filters the current user out of approver candidates,
  // but a direct API call could sneak them in — which would combine
  // badly with the checkPrecheck bypass a self-approver could pull
  // off. Reject the create up front instead of leaving it for the
  // PATCH guard to catch later.
  if (approverUserIds.includes(session.user.id)) {
    return NextResponse.json(
      { error: "You can't add yourself as an approver on your own permit." },
      { status: 400 },
    );
  }

  const approvers = await prisma.user.findMany({
    where: { id: { in: approverUserIds }, active: true },
    select: { id: true },
  });
  if (approvers.length !== approverUserIds.length) {
    return NextResponse.json(
      { error: "One or more approvers are inactive or don't exist" },
      { status: 400 },
    );
  }

  // Co-requesters: same active-user guard. Silently drop the requester
  // themselves if they appear in the list — Colab's picker permits it but
  // it's a no-op on our side.
  const coRequesterIds = Array.from(
    new Set((body.coRequesterIds ?? []).filter((id) => id !== session.user.id)),
  );
  if (coRequesterIds.length > 0) {
    const co = await prisma.user.findMany({
      where: { id: { in: coRequesterIds }, active: true },
      select: { id: true },
    });
    if (co.length !== coRequesterIds.length) {
      return NextResponse.json(
        { error: "One or more co-requesters are inactive or don't exist" },
        { status: 400 },
      );
    }
  }

  // idempotencyKey was already read + short-circuit-checked above.
  const photos = sanitizeUploadUrls(body.photoUrls).slice(0, 6);
  const displayId = generatePermitDisplayId();

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
          // endDate defaults to workDate (same-day permit) when the client
          // doesn't send it — mirrors the schema's nullable behaviour so
          // older builds keep writing single-day rows correctly.
          endDate: body.endDate ? new Date(body.endDate) : new Date(body.workDate),
          startTime: body.startTime,
          endTime: body.endTime,
          location: body.location?.trim() || null,
          contractorId: body.contractorId || null,
          wbsNodeId: body.wbsNodeId || null,
          requesterId: session.user.id,
          // Keep `approverIds` populated for legacy list filters + email
          // fan-out below. Deduped so a multi-level table with the same
          // user at multiple levels still yields a clean id list.
          approverIds: serializeApproverIds(approverUserIds),
          status: "PENDING",
          displayId,
          coRequesterIds,
          activityHead: body.activityHead?.trim() || null,
          // Colab-parity: persist the Step-3 checklist answers verbatim.
          // Null when the client didn't send any (legacy builds or a
          // General Work permit that skipped the checklist).
          checklistResponses: body.checklistResponses ?? undefined,
          idempotencyKey,
          photos:
            photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
          approvers: {
            create: approverRows.map((r, i) => ({
              userId: r.userId,
              levelIndex: r.levelIndex ?? 1,
              levelName: r.levelName?.trim() || `Level ${r.levelIndex ?? 1}`,
              canClose: r.canClose ?? true,
              canSuspend: r.canSuspend ?? false,
              isDefault: r.isDefault ?? false,
              orderIndex: r.orderIndex ?? i,
            })),
          },
          labourEntries:
            body.labourEntries && body.labourEntries.length > 0
              ? {
                  create: body.labourEntries.map((l, i) => ({
                    kind: l.kind ?? "LABOUR",
                    workerName: l.workerName?.trim() || null,
                    role: l.role?.trim() || null,
                    count: l.count ?? null,
                    orderIndex: l.orderIndex ?? i,
                  })),
                }
              : undefined,
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
      summary: `Work permit raised${workPermit.displayId ? ` ${workPermit.displayId}` : ""}: ${workPermit.type} · ${workPermit.title}`,
    });

    // Approver notification emails. Fire-and-forget after DB commit — silent
    // no-op when a candidate has no email on file or RESEND_API_KEY isn't
    // set on the deploy. Batched by Promise.allSettled so one bad address
    // doesn't skip the rest.
    const approverRecipients = await prisma.user.findMany({
      where: { id: { in: approverUserIds }, email: { not: null } },
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

    // Push notification alongside the email — reaches the approver's phone
    // even when Siddhi is closed and email is unread. First-approver-wins,
    // but we notify all listed approvers so any of them can pick it up.
    //
    // AWAIT (see twin comment in /api/inspections/route.ts): on Vercel
    // serverless the function is shut down the moment the HTTP response
    // returns, killing any still-pending fire-and-forget writes — which
    // is why the Notification-inbox rows for Girish never appeared even
    // though the code called sendPushToUser. allSettled so one slow /
    // failing push doesn't stall the rest.
    const typeLabel = WORK_PERMIT_TYPE_LABELS[workPermit.type as WorkPermitType] ?? workPermit.type;
    const requesterName = workPermit.requester?.name ?? "Someone";
    await Promise.allSettled(
      approverUserIds.map((approverId) =>
        sendPushToUser(approverId, {
          title: `Permit awaiting your approval · ${workPermit.title.slice(0, 40)}`,
          body: `${typeLabel} raised by ${requesterName}. Tap to review.`,
          url: `/mobile/${body.projectId}/permit/${workPermit.id}`,
          tag: `permit-${workPermit.id}`,
        }),
      ),
    );

    // Also FYI-ping the planner queue (Shraddha 2026-09-30: Harish, DPM
    // Projects, needs the permit to appear in his alerts even when he
    // isn't the picked approver — same as Colab's project-lead
    // broadcast). Skips the requester and anyone who is already in the
    // approver list to avoid a double buzz. Tag is a distinct FYI tag
    // so it doesn't replace the approver's own permit notification.
    const planners = await prisma.user.findMany({
      where: {
        active: true,
        role: "PLANNER",
        id: {
          notIn: [session.user.id, ...approverUserIds],
        },
      },
      select: { id: true },
    });
    await Promise.allSettled(
      planners.map((p) =>
        sendPushToUser(p.id, {
          title: `Permit raised · ${workPermit.title.slice(0, 40)}`,
          body: `${typeLabel} by ${requesterName}. For your visibility.`,
          url: `/mobile/${body.projectId}/permit/${workPermit.id}`,
          tag: `permit-fyi-${workPermit.id}`,
        }),
      ),
    );
  }

  return NextResponse.json({ workPermit }, { status: duplicate ? 200 : 201 });
}
