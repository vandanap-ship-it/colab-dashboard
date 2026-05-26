import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const VALID_TYPES = new Set(["LABOUR_SUPPLY", "PRW", "MISC"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const wbsNodeId = searchParams.get("wbsNodeId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where: { projectId: string; wbsNodeId?: string } = { projectId };
  if (wbsNodeId) where.wbsNodeId = wbsNodeId;

  const entries = await prisma.progressEntry.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
    include: {
      createdBy: { select: { id: true, name: true } },
      contractor: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
      labour: { select: { id: true, category: true, count: true } },
      wbsNode: { select: { id: true, name: true, taskCode: true, totalQuantity: true, unit: true } },
    },
  });

  return NextResponse.json({ entries });
}

type LabourInput = { category?: string; count?: number };

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const {
    wbsNodeId,
    date,
    type,
    achievedQuantity,
    cumulativeQuantity,
    contractorId,
    notes,
    labour,
    photoUrls,
  } = (body ?? {}) as {
    wbsNodeId?: string;
    date?: string;
    type?: string;
    achievedQuantity?: number;
    cumulativeQuantity?: number;
    contractorId?: string | null;
    notes?: string;
    labour?: LabourInput[];
    photoUrls?: string[];
  };

  if (!wbsNodeId) return NextResponse.json({ error: "wbsNodeId required" }, { status: 400 });
  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: { id: true, projectId: true, contractorId: true, totalQuantity: true },
  });
  if (!node) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  const finalType = type && VALID_TYPES.has(type) ? type : "LABOUR_SUPPLY";
  const entryDate = date ? new Date(date) : new Date();
  if (isNaN(entryDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const achieved = Number(achievedQuantity ?? 0);
  const cumulative = Number(cumulativeQuantity ?? 0);

  const labourClean = Array.isArray(labour)
    ? labour
        .map((l) => ({ category: (l.category ?? "").trim(), count: Math.max(0, Math.floor(Number(l.count ?? 0))) }))
        .filter((l) => l.category.length > 0 && l.count > 0)
    : [];

  const photosClean = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.length > 0).slice(0, 6) : [];

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.progressEntry.create({
      data: {
        projectId: node.projectId,
        wbsNodeId,
        date: entryDate,
        type: finalType,
        achievedQuantity: isFinite(achieved) ? achieved : 0,
        cumulativeQuantity: isFinite(cumulative) ? cumulative : 0,
        contractorId: contractorId ?? null,
        notes: notes?.trim() || null,
        createdById: session.user.id,
        labour: labourClean.length > 0 ? { create: labourClean } : undefined,
        photos: photosClean.length > 0 ? { create: photosClean.map((url) => ({ url })) } : undefined,
      },
      include: {
        labour: true,
        photos: true,
        contractor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    // Update activity % complete from cumulative if total quantity known.
    if (node.totalQuantity && node.totalQuantity > 0 && isFinite(cumulative)) {
      const pct = Math.max(0, Math.min(100, (cumulative / node.totalQuantity) * 100));
      const current = await tx.wBSNode.findUnique({
        where: { id: wbsNodeId },
        select: { actualStart: true, actualFinish: true },
      });
      const updates: { percentComplete: number; actualStart?: Date; actualFinish?: Date } = { percentComplete: pct };
      if (current && !current.actualStart) updates.actualStart = entryDate;
      if (pct >= 100 && current && !current.actualFinish) updates.actualFinish = entryDate;
      await tx.wBSNode.update({ where: { id: wbsNodeId }, data: updates });
    }

    return created;
  });

  await recordAudit({
    projectId: node.projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "ProgressEntry",
    entityId: entry.id,
    summary: `Progress logged for activity (${achieved} achieved, cumulative ${cumulative})`,
  });

  return NextResponse.json({ entry }, { status: 201 });
}
