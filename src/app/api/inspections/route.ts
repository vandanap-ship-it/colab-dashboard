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
import { ROLES } from "@/lib/roles";

const PostInspectionSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  title: z.string().min(3).max(200),
  items: z.array(
    z.object({
      label: z.string().max(300).optional(),
      passed: z.union([z.boolean(), z.null()]).optional(),
      // Yes / No / NA — NA is a real construction answer for scope items
      // that don't apply to this specific villa/section. Client sends true
      // when the engineer picked N/A; server treats it as an "answered"
      // response equivalent to Yes/No.
      notApplicable: z.boolean().optional(),
      notes: z.string().max(500).optional(),
      // Colab parity — each checklist row can carry a single photo of the
      // checkpoint. Already uploaded by the client via /api/upload; here
      // we just store the URL against the row.
      photoUrl: z.string().url().nullable().optional(),
    }),
  ).max(100).optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  // Colab parity — reviewers explicitly picked at submit time. When empty,
  // the API falls back to the role-based broadcast (planners + product +
  // admin) so the queue never sits with no one notified.
  assignedReviewerIds: z.array(z.string().min(1)).max(20).optional(),
  // Free-text remark shown in the Send For Review popup on Colab. Optional
  // — draft submissions and pre-Sep-2026 clients don't send it.
  submitRemark: z.string().max(2000).optional(),
  // Save-as-Draft (Colab step 7 · third button). "draft" skips the
  // every-row-answered validation, skips the reviewer push, and lands
  // the WIR in status=DRAFT so it only shows up in the filler's own
  // "Drafts" tab. "review" (the default) is the pre-existing Send For
  // Review flow — untouched clients keep working exactly like before.
  mode: z.enum(["draft", "review"]).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const STATUSES = new Set(["IN_REVIEW", "PASSED", "REJECTED", "RESCHEDULED", "DRAFT"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Inspections belong to QAQC or SAFETY. A scoped contractor with only
  // HINDRANCE/CONCERN/etc. has no legitimate reason to hit this endpoint;
  // block them before the query so counts don't leak. Full-access users pass.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const filledById = searchParams.get("filledById");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: {
    projectId: string;
    status?: string | { not: string };
    filledById?: string;
    module?: string;
    deletedAt: null;
  } = { projectId, deletedAt: null };
  if (status && STATUSES.has(status)) {
    where.status = status;
  } else {
    // No explicit status filter → drafts are per-filler and shouldn't
    // leak into anyone else's list. The default list dumps everything
    // except DRAFT so reviewers never see in-progress checklists.
    where.status = { not: "DRAFT" };
  }
  if (filledById) where.filledById = filledById;
  // A ?status=DRAFT query is only legitimate when the caller is asking
  // for their own drafts. Force the filter so the request can't scrape
  // another user's in-progress checklists.
  if (status === "DRAFT") where.filledById = session.user.id;
  // Scoped contractors only see inspections tagged to their module.
  const scopedModule = isScopedUser(session.user.modules) ? primaryModuleFor(session.user.modules) : null;
  if (scopedModule) where.module = scopedModule;

  const inspections = await prisma.inspection.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      filledBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      items: { orderBy: { orderIndex: "asc" } },
      photos: { select: { id: true, url: true } },
    },
  });

  // Apply the same module scope to the counts — otherwise a scoped user
  // sees status pills that count inspections outside their module.
  const grouped = await prisma.inspection.groupBy({
    by: ["status"],
    where: scopedModule ? { projectId, module: scopedModule } : { projectId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { IN_REVIEW: 0, PASSED: 0, REJECTED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ inspections, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Inspections belong to QAQC or SAFETY.
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    return NextResponse.json({ error: "Your account doesn't have access to inspections." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostInspectionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, wbsNodeId, title, items, photoUrls, assignedReviewerIds, submitRemark, mode } = body;
  const t = title.trim();
  const isDraft = mode === "draft";

  // Refuse the submission if any non-empty item is unanswered. Since the
  // Jun-2026 tightening we need an explicit answer per item — now that
  // means Yes, No, OR NA (the Colab three-way). Only untouched
  // (notApplicable === false AND passed === null) rows fail. Drafts
  // (mode=draft) skip this — the whole point of a draft is that the
  // filler hasn't finished answering every row yet.
  const candidateItems = Array.isArray(items) ? items : [];
  const itemsClean: Array<{ label: string; passed: boolean | null; notApplicable: boolean; notes: string | null; photoUrl: string | null; orderIndex: number }> = [];
  for (let idx = 0; idx < candidateItems.length; idx++) {
    const i = candidateItems[idx];
    const label = (i.label ?? "").trim();
    if (label.length === 0) continue;
    const isNA = i.notApplicable === true;
    if (!isDraft && !isNA && typeof i.passed !== "boolean") {
      return NextResponse.json(
        { error: `Item "${label}" was not marked Yes, No or N/A.` },
        { status: 400 },
      );
    }
    itemsClean.push({
      label,
      // NA stores passed=null + notApplicable=true so downstream readers
      // don't confuse "not applicable" with "not answered yet". A draft
      // row that's still untouched writes passed=null too — same
      // storage shape as pre-answer state, exactly what a resume-edit
      // (once we ship it) would need to render the row untouched.
      passed: isNA ? null : (typeof i.passed === "boolean" ? i.passed : null),
      notApplicable: isNA,
      notes: i.notes?.trim() || null,
      // Per-row photo (Colab step 6): a single URL, already uploaded by
      // the client. Blank string is normalized to null so downstream
      // readers can rely on a truthy check.
      photoUrl: (i.photoUrl?.trim?.() || null) as string | null,
      orderIndex: idx,
    });
  }
  if (itemsClean.length === 0) return NextResponse.json({ error: "At least one checklist item required" }, { status: 400 });

  // Cross-project FK guard on the activity tag.
  const wbsErr = await assertWbsNodeInProject(wbsNodeId, projectId);
  if (wbsErr) return NextResponse.json({ error: wbsErr }, { status: 400 });

  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 8) : [];
  const moduleTag = primaryModuleFor(session.user.modules);
  const idempotencyKey = readIdempotencyKey(body);

  // De-dupe assigned reviewers and drop the filler themselves — a WIR
  // reviewed by its own author defeats the checklist. Cap at 20 to match
  // the schema; a WIR with dozens of "reviewers" is a signal something is
  // structurally off, not that we should silently accept it.
  const cleanReviewerIds = Array.isArray(assignedReviewerIds)
    ? [...new Set(assignedReviewerIds.filter((id) => typeof id === "string" && id.length > 0 && id !== session.user.id))].slice(0, 20)
    : [];
  const cleanSubmitRemark = submitRemark?.trim() || null;
  const inspectionInclude = {
    filledBy: { select: { id: true, name: true } },
    reviewedBy: { select: { id: true, name: true } },
    wbsNode: { select: { id: true, name: true, taskCode: true } },
    items: { orderBy: { orderIndex: "asc" as const } },
    photos: true,
  } as const;

  const { record: inspection, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.inspection.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: inspectionInclude }),
    () =>
      prisma.inspection.create({
        data: {
          projectId,
          wbsNodeId: wbsNodeId || null,
          title: t,
          // Draft submissions land in DRAFT, not IN_REVIEW — the whole
          // point is that the filler hasn't sent it for review yet. The
          // default @default("IN_REVIEW") applies for every other mode.
          ...(isDraft ? { status: "DRAFT" } : {}),
          module: moduleTag,
          filledById: session.user.id,
          idempotencyKey,
          submitRemark: cleanSubmitRemark,
          assignedReviewerIds: cleanReviewerIds,
          items: { create: itemsClean },
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: inspectionInclude,
      }),
  );

  if (!duplicate) {
    const passedCount = itemsClean.filter((i) => i.passed === true).length;
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Inspection",
      entityId: inspection.id,
      // Two audit summaries: drafts read as "Draft saved" so the
      // history says who paused and when. Send-for-review keeps the
      // pass/total in the summary so the audit trail is scannable.
      summary: isDraft
        ? `Inspection saved as draft: "${t}" (${itemsClean.length} row${itemsClean.length === 1 ? "" : "s"})`
        : `Inspection submitted: "${t}" (${passedCount}/${itemsClean.length} passed)`,
    });

    // Skip the reviewer push entirely for drafts — nothing has been
    // sent for review, so pinging planners about a WIR they can't see
    // would be worse than useless. When it later transitions to
    // IN_REVIEW (via the resume-edit + Send For Review path, once
    // shipped), the push fires from that endpoint instead.
    if (isDraft) {
      return NextResponse.json({ inspection }, { status: 201 });
    }

    // Push the WIR to the people who need to review it. Colab lets the
    // filler pick reviewers explicitly at submit time; when they do, only
    // those people get pinged (and the push body names it as an
    // assignment, not a broadcast). When they don't, fall back to the
    // legacy role-based broadcast so the queue never sits with no one
    // notified. The filler themselves is always skipped.
    let reviewerIds: string[];
    let assigned = false;
    if (cleanReviewerIds.length > 0) {
      const eligible = await prisma.user.findMany({
        where: {
          active: true,
          id: { in: cleanReviewerIds },
          role: { in: [ROLES.PLANNER, ROLES.PRODUCT_TEAM, ROLES.ADMIN, ROLES.SITE_MANAGER] },
        },
        select: { id: true },
      });
      reviewerIds = eligible.map((u) => u.id);
      assigned = true;
    } else {
      const reviewers = await prisma.user.findMany({
        where: {
          active: true,
          role: { in: [ROLES.PLANNER, ROLES.PRODUCT_TEAM, ROLES.ADMIN] },
          id: { not: session.user.id },
        },
        select: { id: true },
      });
      reviewerIds = reviewers.map((u) => u.id);
    }
    for (const rid of reviewerIds) {
      void sendPushToUser(rid, {
        title: assigned
          ? `Assigned WIR · ${t.slice(0, 40)}`
          : `New WIR to review · ${t.slice(0, 40)}`,
        body: `${session.user.name ?? session.user.username} submitted ${itemsClean.length} item${itemsClean.length === 1 ? "" : "s"}.${passedCount === itemsClean.length ? " All Yes so far." : ""}${cleanSubmitRemark ? ` · "${cleanSubmitRemark.slice(0, 80)}"` : ""}`,
        url: `/mobile/${projectId}/qaqc/${inspection.id}?tab=pending${moduleTag ? `&module=${moduleTag}` : ""}`,
        tag: `wir-new-${inspection.id}`,
      });
    }
  }

  return NextResponse.json({ inspection }, { status: duplicate ? 200 : 201 });
}
