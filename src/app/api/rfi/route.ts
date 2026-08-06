import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import {
  RFI_STATUSES,
  formatRfiNumber,
  nextRfiNumber,
  validateCreateRfi,
  type RfiCategory,
  type RfiPriority,
  type RfiStatus,
} from "@/lib/rfi";

const RFI_INCLUDE = {
  raisedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  answeredBy: { select: { id: true, name: true } },
  wbsNode: { select: { id: true, name: true, taskCode: true } },
  photos: { select: { id: true, url: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    return NextResponse.json({ rfis: [], counts: { OPEN: 0, ANSWERED: 0, CLOSED: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const assignedToMe = searchParams.get("assignedToMe") === "1";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: {
    projectId: string;
    status?: RfiStatus;
    assignedToId?: string;
  } = { projectId };
  if (status && (RFI_STATUSES as readonly string[]).includes(status)) {
    where.status = status as RfiStatus;
  }
  if (assignedToMe) where.assignedToId = session.user.id;

  const rfis = await prisma.rfi.findMany({
    where,
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    include: RFI_INCLUDE,
  });

  const grouped = await prisma.rfi.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { OPEN: 0, ANSWERED: 0, CLOSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ rfis, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    return NextResponse.json({ error: "Your account doesn't have access to RFIs." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as {
    projectId?: string;
    subject?: string;
    description?: string;
    category?: RfiCategory;
    priority?: RfiPriority;
    assignedToId?: string | null;
    wbsNodeId?: string | null;
    dueDate?: string | null;
    photoUrls?: string[];
  };

  if (!raw.projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const errors = validateCreateRfi(raw);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors }, { status: 400 });
  }

  const photos = Array.isArray(raw.photoUrls)
    ? raw.photoUrls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 6)
    : [];
  const idempotencyKey = readIdempotencyKey(body);

  // Sequential per-project number is allocated inside the create transaction so
  // two concurrent POSTs don't get the same number (Postgres unique constraint
  // catches races; we retry once on collision).
  const runCreate = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const number = await nextRfiNumber(prisma, raw.projectId!);
      try {
        return await prisma.rfi.create({
          data: {
            projectId: raw.projectId!,
            number,
            subject: raw.subject!.trim(),
            description: raw.description!.trim(),
            category: raw.category!,
            priority: raw.priority ?? "MEDIUM",
            assignedToId: raw.assignedToId || null,
            wbsNodeId: raw.wbsNodeId || null,
            dueDate: raw.dueDate ? new Date(raw.dueDate) : null,
            raisedById: session.user.id,
            idempotencyKey,
            photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
          },
          include: RFI_INCLUDE,
        });
      } catch (e) {
        // Unique constraint on (projectId, number) — another request grabbed it. Retry.
        if (e instanceof Error && e.message.includes("Unique constraint")) continue;
        throw e;
      }
    }
    throw new Error("Failed to allocate RFI number after 3 attempts");
  };

  const { record: rfi, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.rfi.findUnique({
      where: { idempotencyKey: idempotencyKey! },
      include: RFI_INCLUDE,
    }),
    runCreate,
  );

  if (!duplicate) {
    await recordAudit({
      projectId: raw.projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Rfi",
      entityId: rfi.id,
      summary: `${formatRfiNumber(rfi.number)} raised: ${rfi.subject}`,
    });
  }

  return NextResponse.json({ rfi }, { status: duplicate ? 200 : 201 });
}
