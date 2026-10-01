import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, primaryModuleFor, isScopedUser, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody } from "@/lib/parseBody";
import { assertWbsNodeInProject } from "@/lib/projectFkGuards";
import { sanitizeUploadUrls } from "@/lib/upload";
import { sendPushToUser } from "@/lib/push";

// Colab-parity severity vocab: Minor / Major / Critical (was LOW / MEDIUM
// / HIGH pre-Sep 2026). The `Legacy…` values are accepted from
// pre-parity mobile builds still in the wild so an offline queue that
// syncs late doesn't 400 — they are re-mapped to the new vocab
// server-side.
const SEVERITIES = new Set(["Minor", "Major", "Critical"]);
const CATEGORIES = new Set(["Quality", "Safety", "Workmanship"]);

const PostIssueSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  description: z.string().min(3, "Description too short").max(2000),
  severity: z
    .enum(["Minor", "Major", "Critical", "LOW", "MEDIUM", "HIGH"])
    .optional(),
  category: z.string().max(60).optional(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  assignedToId: z.string().min(1).optional(),
  // Colab-parity fields (Sep 2026 batch 3).
  parallelAssigneeIds: z.array(z.string().min(1)).max(20).optional(),
  dueDate: z.string().optional(),        // ISO date string
  debitToId: z.string().min(1).nullable().optional(),
  debitAmount: z.number().min(0).nullable().optional(),
  inspectionId: z.string().min(1).nullable().optional(),
  // Villa the observation is tagged to (Shraddha 2026-09-30). Independent
  // of wbsNodeId — a project-level observation with no specific activity
  // can still carry the villa for downstream reports.
  villaId: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().max(120).optional(),
});
// REJECTED added 2026-10-01 for Colab-parity 4-tab list (New / In Review /
// Closed / Rejected). Status is stored as a plain String column, not a
// Prisma enum, so adding a new value is a validator-only change.
const STATUSES = new Set(["OPEN", "RESOLVED", "IN_REINSPECTION", "REJECTED"]);

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

  // Idempotency short-circuit · if this replay has already been
  // committed, skip validation and return the existing row. Between
  // the original write and the retry, the assignee could be
  // deactivated / the wbsNode soft-deleted / the debit contractor
  // moved — all would 400 the retry even though the row already
  // exists.
  const idempotencyKeyEarly = readIdempotencyKey(body);
  if (idempotencyKeyEarly) {
    const existing = await prisma.issue.findUnique({
      where: { idempotencyKey: idempotencyKeyEarly },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        wbsNode: { select: { id: true, name: true, taskCode: true } },
        villa: { select: { id: true, number: true, label: true } },
        photos: true,
      },
    });
    if (existing) {
      return NextResponse.json({ issue: existing }, { status: 200 });
    }
  }
  const {
    projectId,
    wbsNodeId,
    description,
    severity,
    category,
    photoUrls,
    assignedToId,
    parallelAssigneeIds,
    dueDate,
    debitToId,
    debitAmount,
    inspectionId,
    villaId,
  } = body;
  const desc = description.trim();
  // Re-map legacy LOW/MEDIUM/HIGH to Colab's Minor/Major/Critical so the
  // DB never carries the old vocab after this migration lands.
  const legacyMap: Record<string, string> = { LOW: "Minor", MEDIUM: "Major", HIGH: "Critical" };
  const sev = severity ? (legacyMap[severity] ?? severity) : null;
  if (sev && !SEVERITIES.has(sev)) {
    return NextResponse.json({ error: `Unknown severity: ${sev}` }, { status: 400 });
  }
  const cat = (category ?? "").trim();
  if (cat && !CATEGORIES.has(cat)) {
    return NextResponse.json({ error: `Unknown category: ${cat}` }, { status: 400 });
  }
  const photos = sanitizeUploadUrls(photoUrls).slice(0, 6);
  // Parse dueDate — accepts "2026-09-30" or full ISO; falls back to null.
  const dueDateParsed = dueDate
    ? (() => {
        const d = new Date(dueDate);
        return isNaN(d.getTime()) ? null : d;
      })()
    : null;
  // De-dupe + strip creator from parallel assignees so an author isn't
  // silently notified as their own parallel.
  const cleanParallelIds = Array.isArray(parallelAssigneeIds)
    ? [...new Set(parallelAssigneeIds.filter((id) => typeof id === "string" && id.length > 0 && id !== session.user.id))].slice(0, 20)
    : [];

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

  // Same cross-project guard for the villa tag — a scoped user shouldn't
  // be able to file an observation on Project B's villa via Project A.
  let resolvedVillaId: string | null = villaId ?? null;
  if (resolvedVillaId) {
    const villa = await prisma.villa.findUnique({
      where: { id: resolvedVillaId },
      select: { projectId: true },
    });
    if (!villa) {
      return NextResponse.json({ error: "Villa not found" }, { status: 400 });
    }
    if (villa.projectId !== projectId) {
      return NextResponse.json({ error: "Villa is not on this project" }, { status: 400 });
    }
  }
  // Auto-fill villa from the picked activity when the filler didn't
  // pick one explicitly — Colab implicitly tags observations to the
  // activity's villa. Skips when villaId was already sent so an
  // intentionally-different villa (rare, but possible) survives.
  if (!resolvedVillaId && wbsNodeId) {
    const node = await prisma.wBSNode.findUnique({
      where: { id: wbsNodeId },
      select: { villaId: true },
    });
    if (node?.villaId) resolvedVillaId = node.villaId;
  }

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
    villa: { select: { id: true, number: true, label: true } },
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
          villaId: resolvedVillaId,
          description: desc,
          severity: sev,
          category: cat.length > 0 ? cat : null,
          module: moduleTag,
          createdById: session.user.id,
          assignedToId: resolvedAssigneeId,
          // Colab-parity fields.
          parallelAssigneeIds: cleanParallelIds,
          dueDate: dueDateParsed,
          debitToId: debitToId || null,
          debitAmount: typeof debitAmount === "number" ? debitAmount : null,
          inspectionId: inspectionId || null,
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
      // Await — see /api/inspections/route.ts twin comment.
      await sendPushToUser(resolvedAssigneeId, {
        title: "Snag assigned to you",
        body: `${preview} · from ${session.user.name ?? "site team"}`,
        url: `/mobile/${projectId}/my-actions`,
        tag: `snag-${issue.id}`,
      });
    }
  }

  return NextResponse.json({ issue }, { status: duplicate ? 200 : 201 });
}
