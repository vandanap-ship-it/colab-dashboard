import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUSES = new Set(["PENDING", "READ", "RESOLVED", "TASK_ASSIGNED"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, wbsNodeId, description, photoUrls } = (body ?? {}) as {
    projectId?: string;
    wbsNodeId?: string;
    description?: string;
    photoUrls?: string[];
  };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const desc = (description ?? "").trim();
  if (desc.length < 3) return NextResponse.json({ error: "Description too short" }, { status: 400 });
  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 6) : [];

  const concern = await prisma.concern.create({
    data: {
      projectId,
      wbsNodeId: wbsNodeId || null,
      description: desc,
      raisedById: session.user.id,
      photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
    },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: true,
    },
  });

  return NextResponse.json({ concern }, { status: 201 });
}
