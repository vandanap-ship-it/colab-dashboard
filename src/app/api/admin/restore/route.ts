import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit, type AuditEntityType } from "@/lib/audit";

const RESTORABLE: Record<string, AuditEntityType> = {
  ProgressEntry: "ProgressEntry",
  Issue: "Issue",
  Hindrance: "Hindrance",
  Concern: "Concern",
  Inspection: "Inspection",
};

/**
 * Restore a soft-deleted record. Admin-only. POST body:
 *   { entityType: "ProgressEntry" | "Issue" | "Hindrance" | "Concern" | "Inspection",
 *     id: "..." }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { entityType?: string; id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entityType = body.entityType ? RESTORABLE[body.entityType] : null;
  if (!entityType) {
    return NextResponse.json(
      { error: `entityType must be one of: ${Object.keys(RESTORABLE).join(", ")}` },
      { status: 400 },
    );
  }
  const id = body.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    let projectId: string | null = null;
    switch (entityType) {
      case "ProgressEntry": {
        const found = await prisma.progressEntry.findFirst({
          where: { id, deletedAt: { not: null } },
          select: { id: true, projectId: true },
        });
        if (!found) return NextResponse.json({ error: "Not found in trash" }, { status: 404 });
        projectId = found.projectId;
        await prisma.progressEntry.update({ where: { id }, data: { deletedAt: null } });
        break;
      }
      case "Issue": {
        const found = await prisma.issue.findFirst({
          where: { id, deletedAt: { not: null } },
          select: { id: true, projectId: true },
        });
        if (!found) return NextResponse.json({ error: "Not found in trash" }, { status: 404 });
        projectId = found.projectId;
        await prisma.issue.update({ where: { id }, data: { deletedAt: null } });
        break;
      }
      case "Hindrance": {
        const found = await prisma.hindrance.findFirst({
          where: { id, deletedAt: { not: null } },
          select: { id: true, projectId: true },
        });
        if (!found) return NextResponse.json({ error: "Not found in trash" }, { status: 404 });
        projectId = found.projectId;
        await prisma.hindrance.update({ where: { id }, data: { deletedAt: null } });
        break;
      }
      case "Concern": {
        const found = await prisma.concern.findFirst({
          where: { id, deletedAt: { not: null } },
          select: { id: true, projectId: true },
        });
        if (!found) return NextResponse.json({ error: "Not found in trash" }, { status: 404 });
        projectId = found.projectId;
        await prisma.concern.update({ where: { id }, data: { deletedAt: null } });
        break;
      }
      case "Inspection": {
        const found = await prisma.inspection.findFirst({
          where: { id, deletedAt: { not: null } },
          select: { id: true, projectId: true },
        });
        if (!found) return NextResponse.json({ error: "Not found in trash" }, { status: 404 });
        projectId = found.projectId;
        await prisma.inspection.update({ where: { id }, data: { deletedAt: null } });
        break;
      }
    }

    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "RESTORE",
      entityType,
      entityId: id,
      summary: `${entityType} restored from trash`,
    });

    return NextResponse.json({ ok: true, entityType, id });
  } catch (e) {
    console.error("[POST /api/admin/restore]", e);
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}
