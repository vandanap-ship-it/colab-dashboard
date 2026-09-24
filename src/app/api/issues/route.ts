import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, primaryModuleFor, isScopedUser, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody } from "@/lib/parseBody";
import { assertWbsNodeInProject } from "@/lib/projectFkGuards";
import { sendPushToUser } from "@/lib/push";

const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH"]);

const PostIssueSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  description: z.string().min(3, "Description too short").max(2000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  category: z.string().max(60).optional(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  assignedToId: z.string().min(1).optional(),
  idempotencyKey: z.string().max(120).optional(),
});
const STATUSES = new Set(["OPEN", "RESOLVED", "IN_REINSPECTION"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same gate as the POST below: snags belong to QAQC or SAFETY. A scoped
  // user without either module has no legitimate reason to hit this list.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string; module?: string; deletedAt: null } = { projectId, deletedAt: null };
  if (status && STATUSES.has(status)) where.status = status;
  // Scoped contractors only see snags tagged to their module.
  if (isScopedUser(session.user.modules)) {
    const m = primaryModuleFor(session.user.modules);
    if (m) where.module = m;
  }

  const issues = await prisma.issue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  return NextResponse.json({ issues });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Snags belong to QAQC or SAFETY — scoped users must have one of those.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Your account doesn't have access to raise snags." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostIssueSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, wbsNodeId, description, severity, category, photoUrls, assignedToId } = body;
  const desc = description.trim();
  const sev = severity ?? null;
  const cat = (category ?? "").trim();
  const photos = (photoUrls ?? []).slice(0, 6);
  void SEVERITIES; // superseded by zod enum

  // If an assignee is set, verify they exist + are active before creating —
  // matches the PATCH guard so create + assign-on-create stay symmetric.
  if (assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, active: true },
    });
    if (!assignee) return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
    if (!assignee.active) {
      return NextResponse.json({ error: "Cannot assign to a deactivated user." }, { status: 400 });
    }
  }

  // Cross-project FK guard on the activity tag.
  const wbsErr = await assertWbsNodeInProject(wbsNodeId, projectId);
  if (wbsErr) return NextResponse.json({ error: wbsErr }, { status: 400 });

  // Auto-tag the responsible contractor. Shraddha, Sep 24: "you know
  // which contractor is associated with which villa. Auto-tag them and
  // send a notification."
  //
  // Path: wbsNode → activity's contractorId → first active user tied to
  // that contractor. Only runs when the caller didn't already provide
  // an explicit assignedToId, and when a wbsNode was picked (a
  // free-floating snag with no activity has no contractor to infer).
  // Notifications follow from the existing assignment-side-effect
  // hooks once assignedToId is set.
  let resolvedAssigneeId: string | null = assignedToId ?? null;
  if (!resolvedAssigneeId && wbsNodeId) {
    const node = await prisma.wBSNode.findUnique({
      where: { id: wbsNodeId },
      select: { contractorId: true },
    });
    if (node?.contractorId) {
      const contractorUser = await prisma.user.findFirst({
        where: { contractorId: node.contractorId, active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (contractorUser) {
        resolvedAssigneeId = contractorUser.id;
      }
    }
  }

  // Tag the snag with the creator's module so scoped contractors only ever
  // see their own module's snags. Full-access staff create untagged snags.
  const moduleTag = primaryModuleFor(session.user.modules);
  const idempotencyKey = readIdempotencyKey(body);
  const issueInclude = {
    createdBy: { select: { id: true, name: true } },
    assignedTo: { select: { id: true, name: true } },
    wbsNode: { select: { id: true, name: true, taskCode: true } },
    photos: true,
  } as const;

  const { record: issue, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.issue.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: issueInclude }),
    () =>
      prisma.issue.create({
        data: {
          projectId,
          wbsNodeId: wbsNodeId || null,
          description: desc,
          severity: sev,
          category: cat.length > 0 ? cat : null,
          module: moduleTag,
          createdById: session.user.id,
          assignedToId: resolvedAssigneeId,
          idempotencyKey,
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: issueInclude,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Issue",
      entityId: issue.id,
      summary: `Snag raised: ${desc.length > 60 ? desc.slice(0, 60) + "…" : desc}`,
    });

    // Push a notification to the assignee when we auto-tagged (or the
    // caller supplied) an assignedToId on create. Mirrors the PATCH-
    // time notification in issues/[id] so an assign-on-create doesn't
    // silently skip the ping. Never notifies self — a QAQC reviewer
    // raising a snag on an activity they somehow own shouldn't get
    // their own push tile.
    if (resolvedAssigneeId && resolvedAssigneeId !== session.user.id) {
      const preview = desc.length > 60 ? desc.slice(0, 60) + "…" : desc;
      void sendPushToUser(resolvedAssigneeId, {
        title: "Snag assigned to you",
        body: `${preview} · from ${session.user.name ?? "site team"}`,
        url: `/mobile/${projectId}/my-actions`,
        tag: `snag-${issue.id}`,
      });
    }
  }

  return NextResponse.json({ issue }, { status: duplicate ? 200 : 201 });
}
