import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { parseBody } from "@/lib/parseBody";

const PostConcernSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  description: z.string().min(3, "Description too short").max(2000),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const STATUSES = new Set(["PENDING", "READ", "RESOLVED", "TASK_ASSIGNED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.CONCERN)) {
    return NextResponse.json({ concerns: [], counts: { PENDING: 0, READ: 0, RESOLVED: 0, TASK_ASSIGNED: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string } = { projectId };
  if (status && STATUSES.has(status)) where.status = status;

  const concerns = await prisma.concern.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: { select: { id: true, url: true } },
    },
  });

  // Counts per status (handy for tabs)
  const grouped = await prisma.concern.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { PENDING: 0, READ: 0, RESOLVED: 0, TASK_ASSIGNED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({ concerns, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.CONCERN)) {
    return NextResponse.json({ error: "Your account doesn't have access to concerns." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostConcernSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, wbsNodeId, description, photoUrls } = body;
  const desc = description.trim();
  const photos = (photoUrls ?? []).slice(0, 6);
  const idempotencyKey = readIdempotencyKey(body);
  const concernInclude = {
    raisedBy: { select: { id: true, name: true } },
    assignedTo: { select: { id: true, name: true } },
    wbsNode: { select: { id: true, name: true, taskCode: true } },
    photos: true,
  } as const;

  const { record: concern, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.concern.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: concernInclude }),
    () =>
      prisma.concern.create({
        data: {
          projectId,
          wbsNodeId: wbsNodeId || null,
          description: desc,
          raisedById: session.user.id,
          idempotencyKey,
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: concernInclude,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Concern",
      entityId: concern.id,
      summary: `Concern raised: ${desc.length > 60 ? desc.slice(0, 60) + "…" : desc}`,
    });
  }

  return NextResponse.json({ concern }, { status: duplicate ? 200 : 201 });
}
