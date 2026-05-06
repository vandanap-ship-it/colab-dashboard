import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";

const VALID_STATUSES = new Set(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]);

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true, username: true } } },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, code, status, startDate, endDate, address } = (body ?? {}) as {
    name?: string;
    code?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    address?: string;
  };

  const trimmed = (name ?? "").trim();
  if (trimmed.length < 2) {
    return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
  }
  const finalStatus = status && VALID_STATUSES.has(status) ? status : "PLANNING";

  const project = await prisma.project.create({
    data: {
      name: trimmed,
      code: code?.trim() || null,
      status: finalStatus,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      address: address?.trim() || null,
      createdById: session.user.id,
    },
    include: { createdBy: { select: { id: true, name: true, username: true } } },
  });

  return NextResponse.json({ project }, { status: 201 });
}
