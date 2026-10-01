import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES, hasFullAccess } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { recordAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push";
import { isOwnUploadUrl } from "@/lib/upload";
import {
  generateInductionDisplayId,
  computeInductionExpiry,
  INDUCTION_STATUSES,
} from "@/lib/safetyInduction";

/**
 * Safety Induction REST surface. Shraddha 2026-10-01 pulled the module
 * out of Phase 2; this route is the write side (POST create) and the
 * list side (GET filtered by project + tab + status). Detail + PATCH
 * live in /safety-inductions/[id].
 *
 * Access gating:
 *   POST  → user with SAFETY module (contractor-side HSE officers raise;
 *           Girish is the approver, not the raiser). Full-access
 *           internal staff can also raise for testing / backfill.
 *   GET   → same gate — the list belongs to the safety team.
 *
 * The approve/reject gate lives in [id]/route.ts and uses canReview +
 * canAccessScopedRow — same shape as HSE Checklist review (Girish
 * passes as SITE_MANAGER + SAFETY). Keeps the two safety flows gated
 * identically.
 */

const PostInductionSchema = z.object({
  projectId: z.string().min(1),
  // Core 10 fields (see schema comment + colab_safety_induction_spec).
  workerName: z.string().min(1, "Worker name is required").max(120),
  workerPhotoUrl: z.string().url().nullable().optional(),
  trade: z.string().min(1, "Trade is required").max(80),
  contractorId: z.string().min(1).nullable().optional(),
  gender: z.enum(["Male", "Female", "Other"]),
  age: z.number().int().min(16, "Worker must be at least 16").max(99).nullable().optional(),
  dob: z.string().nullable().optional(), // ISO date; parsed server-side
  contactNumber: z.string().max(20).nullable().optional(),
  aadhaarNumber: z
    .string()
    .regex(/^\d{12}$/, "Aadhaar is 12 digits")
    .nullable()
    .optional(),
  aadhaarFrontUrl: z.string().url().nullable().optional(),
  aadhaarBackUrl: z.string().url().nullable().optional(),
  signatureUrl: z.string().url().nullable().optional(),
  // inductionDate defaults to today when omitted. The server owns
  // expiryDate (= +12mo); clients can't override.
  inductionDate: z.string().optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const VALID_STATUSES = new Set(Array.from(INDUCTION_STATUSES));

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    return NextResponse.json(
      { error: "Your account doesn't have access to safety inductions." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  // "me" = inductions this user raised (Submitted By Me tab).
  // "assigned" = inductions awaiting this user's approval (Submitted To Me
  //  tab) — scoped to Pending for the current approver.
  // Not set → "all" (default list view).
  const scope = searchParams.get("scope");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: Record<string, unknown> = { projectId, deletedAt: null };
  if (status && VALID_STATUSES.has(status as never)) where.status = status;
  if (scope === "me") where.createdById = session.user.id;
  if (scope === "assigned") {
    // "Submitted To Me" = Pending inductions this user can act on.
    // Reusing canReview gating here would need module-scope checking per
    // row — simpler to list PENDING + leave the actual approve guard to
    // the PATCH route. Full-access users see everyone's pending.
    where.status = where.status ?? "PENDING";
    if (!hasFullAccess(session.user.modules)) {
      // A SAFETY-scoped user is scoped by module; approver-ness is
      // enforced at PATCH time. Nothing more to narrow here.
    }
  }

  const inductions = await prisma.safetyInduction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      contractor: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, role: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
    },
    take: 200,
  });

  // Counts per status for the tab badges. Scoped to the same base query
  // (project + scope filter) so Submitted By Me's badges only count the
  // user's own rows.
  const grouped = await prisma.safetyInduction.groupBy({
    by: ["status"],
    where: {
      projectId,
      deletedAt: null,
      ...(scope === "me" ? { createdById: session.user.id } : {}),
    },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    EXPIRED: 0,
  };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ inductions, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    return NextResponse.json(
      { error: "Your account doesn't have access to safety inductions." },
      { status: 403 },
    );
  }

  const parsed = await parseBody(req, PostInductionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Verify the project exists + the user can touch it. canAccessModule
  // already said yes to SAFETY; the Project FK below (via Prisma) will
  // guard against a bad projectId with a FK violation we translate.
  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 });

  // Contractor cross-project guard — a user shouldn't be able to tag an
  // induction with a contractor from a different project.
  if (body.contractorId) {
    const contractor = await prisma.contractor.findUnique({
      where: { id: body.contractorId },
      select: { projectId: true },
    });
    if (!contractor) return NextResponse.json({ error: "Contractor not found" }, { status: 400 });
    if (contractor.projectId !== body.projectId) {
      return NextResponse.json(
        { error: "Contractor is not on this project" },
        { status: 400 },
      );
    }
  }

  // URL provenance guard on every photo field — only accept URLs that
  // came out of our own /api/upload (same rule as inspections + permits).
  // Prevents a scripted client from stuffing arbitrary image hosts into
  // the field.
  const guardUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return isOwnUploadUrl(url) ? url : null;
  };

  const inductionDate = body.inductionDate ? new Date(body.inductionDate) : new Date();
  if (Number.isNaN(inductionDate.getTime())) {
    return NextResponse.json({ error: "Invalid inductionDate" }, { status: 400 });
  }
  const expiryDate = computeInductionExpiry(inductionDate);

  const dob = body.dob ? new Date(body.dob) : null;
  if (body.dob && dob && Number.isNaN(dob.getTime())) {
    return NextResponse.json({ error: "Invalid DOB" }, { status: 400 });
  }

  const idempotencyKey = readIdempotencyKey(body);
  const include = {
    contractor: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true, role: true } },
    approvedBy: { select: { id: true, name: true } },
    rejectedBy: { select: { id: true, name: true } },
  } as const;

  const { record: induction, duplicate } = await createIdempotent(
    idempotencyKey,
    () =>
      prisma.safetyInduction.findUnique({
        where: { idempotencyKey: idempotencyKey! },
        include,
      }),
    () =>
      prisma.safetyInduction.create({
        data: {
          projectId: body.projectId,
          displayId: generateInductionDisplayId(),
          workerName: body.workerName.trim(),
          workerPhotoUrl: guardUrl(body.workerPhotoUrl),
          trade: body.trade.trim(),
          contractorId: body.contractorId ?? null,
          gender: body.gender,
          age: body.age ?? null,
          dob,
          contactNumber: body.contactNumber?.trim() || null,
          aadhaarNumber: body.aadhaarNumber ?? null,
          aadhaarFrontUrl: guardUrl(body.aadhaarFrontUrl),
          aadhaarBackUrl: guardUrl(body.aadhaarBackUrl),
          signatureUrl: guardUrl(body.signatureUrl),
          inductionDate,
          expiryDate,
          createdById: session.user.id,
          idempotencyKey,
        },
        include,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId: body.projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "SafetyInduction",
      entityId: induction.id,
      summary: `Safety induction raised ${induction.displayId} for ${induction.workerName} (${induction.trade})`,
    });

    // Push to the approver queue. Same shape as the HSE Checklist raise
    // broadcast (inspections/route.ts): PLANNER + SITE_MANAGER with
    // SAFETY module. For Amanvana today that resolves to Girish R only.
    // Awaited — see notifications_await_fix.
    const approvers = await prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["PLANNER", "SITE_MANAGER"] },
        id: { not: session.user.id },
        modules: { contains: `"${MODULES.SAFETY}"` },
      },
      select: { id: true },
    });
    await Promise.allSettled(
      approvers.map((a) =>
        sendPushToUser(a.id, {
          title: `Induction awaiting your approval · ${induction.workerName}`,
          body: `${induction.displayId} · ${induction.trade}${induction.contractor?.name ? ` · ${induction.contractor.name}` : ""}. Tap to review.`,
          url: `/mobile/${body.projectId}/induction/${induction.id}`,
          tag: `induction-${induction.id}`,
        }),
      ),
    );
  }

  return NextResponse.json({ induction }, { status: duplicate ? 200 : 201 });
}
