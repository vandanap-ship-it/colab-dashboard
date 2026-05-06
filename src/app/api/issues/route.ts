import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH"]);
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

  const issue = await prisma.issue.create({
    data: {
      projectId,
      wbsNodeId: wbsNodeId || null,
      description: desc,
      severity: sev,
      category: cat.length > 0 ? cat : null,
      createdById: session.user.id,
      assignedToId: assignedToId || null,
      photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true } },
      photos: true,
    },
  });

  return NextResponse.json({ issue }, { status: 201 });
}
