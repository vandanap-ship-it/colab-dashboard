import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, primaryModuleFor, isScopedUser, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";

const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH"]);
const STATUSES = new Set(["OPEN", "RESOLVED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string; module?: string } = { projectId };
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

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, wbsNodeId, description, severity, category, photoUrls, assignedToId } =
    (body ?? {}) as {
      projectId?: string;
      wbsNodeId?: string;
      description?: string;
      severity?: string;
      category?: string;
      photoUrls?: string[];
      assignedToId?: string;
    };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const desc = (description ?? "").trim();
  if (desc.length < 3) return NextResponse.json({ error: "Description too short" }, { status: 400 });
  const sev = severity && SEVERITIES.has(severity) ? severity : null;
  const cat = (category ?? "").trim();
  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 6) : [];

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
          assignedToId: assignedToId || null,
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
  }

  return NextResponse.json({ issue }, { status: duplicate ? 200 : 201 });
}
