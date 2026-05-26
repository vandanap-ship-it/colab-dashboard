import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const STATUSES = new Set(["OPEN", "RESOLVED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, wbsNodeId, description, startDate, daysImpact, photoUrls } = (body ?? {}) as {
    projectId?: string;
    wbsNodeId?: string;
    description?: string;
    startDate?: string;
    daysImpact?: number;
    photoUrls?: string[];
  };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const desc = (description ?? "").trim();
  if (desc.length < 3) return NextResponse.json({ error: "Description too short" }, { status: 400 });

  const start = startDate ? new Date(startDate) : new Date();
  if (isNaN(start.getTime())) return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });

  const impact = Number.isFinite(Number(daysImpact)) ? Math.max(0, Math.floor(Number(daysImpact))) : null;
  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 6) : [];

  const hindrance = await prisma.hindrance.create({
    data: {
      projectId,
      wbsNodeId: wbsNodeId || null,
      description: desc,
      startDate: start,
      daysImpact: impact,
      createdById: session.user.id,
      photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: true,
    },
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "Hindrance",
    entityId: hindrance.id,
    summary: `Hindrance logged: ${desc.length > 60 ? desc.slice(0, 60) + "…" : desc}`,
  });

  return NextResponse.json({ hindrance }, { status: 201 });
}
