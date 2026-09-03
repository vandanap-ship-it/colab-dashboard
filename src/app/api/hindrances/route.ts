import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { isValidReasonCode } from "@/lib/hindranceReasons";
import { parseBody, zDateString } from "@/lib/parseBody";

const PostHindranceSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().min(1).nullable().optional(),
  description: z.string().min(3, "Description too short").max(2000),
  startDate: zDateString.optional(),
  daysImpact: z.number().finite().min(0).max(365).optional(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(500).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const STATUSES = new Set(["OPEN", "RESOLVED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    return NextResponse.json({ hindrances: [] });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; status?: string } = { projectId };
  if (status && STATUSES.has(status)) where.status = status;

  const hindrances = await prisma.hindrance.findMany({
    where,
    orderBy: { startDate: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  return NextResponse.json({ hindrances });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    return NextResponse.json({ error: "Your account doesn't have access to hindrances." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostHindranceSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, wbsNodeId, description, startDate, daysImpact, photoUrls, reasonCode, reasonNote } = body;

  const desc = description.trim();
  const start = startDate ? new Date(startDate) : new Date();
  const impact = daysImpact != null ? Math.floor(daysImpact) : null;
  const photos = (photoUrls ?? []).slice(0, 6);
  // Silently drop unknown reason codes (client-only enum guard) rather than
  // rejecting — the record is more important than the tag.
  const reason = isValidReasonCode(reasonCode) ? reasonCode : null;
  const note = (reasonNote ?? "").trim();
  const idempotencyKey = readIdempotencyKey(body);
  const hindranceInclude = {
    createdBy: { select: { id: true, name: true } },
    wbsNode: { select: { id: true, name: true, taskCode: true } },
    photos: true,
  } as const;

  const { record: hindrance, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.hindrance.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: hindranceInclude }),
    () =>
      prisma.hindrance.create({
        data: {
          projectId,
          wbsNodeId: wbsNodeId || null,
          description: desc,
          startDate: start,
          daysImpact: impact,
          reasonCode: reason,
          reasonNote: note || null,
          createdById: session.user.id,
          idempotencyKey,
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: hindranceInclude,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Hindrance",
      entityId: hindrance.id,
      summary: `Hindrance logged: ${desc.length > 60 ? desc.slice(0, 60) + "…" : desc}`,
    });
  }

  return NextResponse.json({ hindrance }, { status: duplicate ? 200 : 201 });
}
