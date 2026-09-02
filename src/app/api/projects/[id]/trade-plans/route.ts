import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { isAdmin, ROLES } from "@/lib/roles";
import { TRADES } from "@/lib/manpower";

const TRADE_SET = new Set<string>(TRADES);

/** Only admins, planners and product team can edit the planned headcount. */
function canEditPlans(role: string): boolean {
  return isAdmin(role) || role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM;
}

const TRADE_PLAN_INCLUDE = {
  contractor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/** GET /api/projects/[id]/trade-plans — current effective plans per contractor × trade. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const plans = await prisma.tradePlan.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ contractorId: "asc" }, { trade: "asc" }, { startDate: "desc" }],
    include: TRADE_PLAN_INCLUDE,
  });
  return NextResponse.json({ plans, trades: TRADES });
}

/**
 * POST /api/projects/[id]/trade-plans — upsert a plan. If a plan already exists
 * for (contractor, trade) with the same startDate, updates its plannedCount +
 * notes. Otherwise creates a new plan (closing the previous one is a UI-level
 * concern for now — we keep history intact by default).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPlans(session.user.role)) {
    return NextResponse.json({ error: "You don't have permission to edit trade plans." }, { status: 403 });
  }

  const { id: projectId } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { contractorId, trade, plannedCount, startDate, endDate, notes } = (body ?? {}) as {
    contractorId?: string;
    trade?: string;
    plannedCount?: number;
    startDate?: string;
    endDate?: string | null;
    notes?: string | null;
  };

  if (!contractorId) return NextResponse.json({ error: "contractorId required" }, { status: 400 });
  if (!trade || !TRADE_SET.has(trade)) {
    return NextResponse.json({ error: `trade must be one of ${TRADES.join(", ")}` }, { status: 400 });
  }
  const rawCount = Number(plannedCount);
  if (!Number.isFinite(rawCount) || rawCount < 0) {
    return NextResponse.json({ error: "plannedCount must be a non-negative number" }, { status: 400 });
  }
  const count = Math.floor(rawCount);

  const start = startDate ? new Date(startDate + "T00:00:00Z") : (() => {
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    return t;
  })();
  if (isNaN(start.getTime())) return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });

  let end: Date | null = null;
  if (endDate) {
    end = new Date(endDate + "T00:00:00Z");
    if (isNaN(end.getTime())) return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: "endDate must be after startDate" }, { status: 400 });
    }
  }

  const cleanNotes = typeof notes === "string" ? notes.trim().slice(0, 500) : "";

  // Verify contractor belongs to project.
  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, projectId },
    select: { id: true, name: true },
  });
  if (!contractor) return NextResponse.json({ error: "Contractor not found on project" }, { status: 404 });

  // Find existing plan with matching (contractor, trade, startDate) to update
  // in place, otherwise create new.
  const existing = await prisma.tradePlan.findFirst({
    where: { projectId, contractorId, trade, startDate: start, deletedAt: null },
    select: { id: true },
  });

  const plan = existing
    ? await prisma.tradePlan.update({
        where: { id: existing.id },
        data: {
          plannedCount: count,
          endDate: end,
          notes: cleanNotes || null,
        },
        include: TRADE_PLAN_INCLUDE,
      })
    : await prisma.tradePlan.create({
        data: {
          projectId,
          contractorId,
          trade,
          plannedCount: count,
          startDate: start,
          endDate: end,
          notes: cleanNotes || null,
          createdById: session.user.id,
        },
        include: TRADE_PLAN_INCLUDE,
      });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: existing ? "UPDATE" : "CREATE",
    entityType: "TradePlan",
    entityId: plan.id,
    summary: `Trade plan: ${contractor.name} · ${trade} → ${count}/day (from ${start.toISOString().slice(0, 10)})`,
  });

  return NextResponse.json({ plan }, { status: existing ? 200 : 201 });
}

/** DELETE /api/projects/[id]/trade-plans?planId=… — soft-delete a plan. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPlans(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await params;
  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const existing = await prisma.tradePlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, contractor: { select: { name: true } }, trade: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.tradePlan.update({
    where: { id: planId },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "DELETE",
    entityType: "TradePlan",
    entityId: planId,
    summary: `Trade plan removed: ${existing.contractor.name} · ${existing.trade}`,
  });

  return NextResponse.json({ ok: true });
}
