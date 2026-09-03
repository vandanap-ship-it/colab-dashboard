import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import { readIdempotencyKey } from "@/lib/idempotency";
import { TRADES } from "@/lib/manpower";
import { parseBody } from "@/lib/parseBody";

const PostManpowerSchema = z.object({
  projectId: z.string().min(1),
  contractorId: z.string().min(1),
  // Trades enforced against the runtime list — zod's z.enum() needs literal
  // union at compile time, but TRADES is `readonly string[]`. Use refine.
  trade: z.string().refine((v) => (TRADES as readonly string[]).includes(v), {
    message: `trade must be one of ${TRADES.join(", ")}`,
  }),
  // ISO date string (YYYY-MM-DD). The handler appends T00:00:00Z below.
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD").optional(),
  actualCount: z.number().finite().min(0).max(1000),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const MANPOWER_INCLUDE = {
  contractor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/** GET /api/manpower-entries?projectId=…&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ entries: [] });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Default window: today only.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = fromStr ? new Date(fromStr + "T00:00:00Z") : today;
  const to = toStr ? new Date(toStr + "T00:00:00Z") : today;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const entries = await prisma.manpowerEntry.findMany({
    where: {
      projectId,
      entryDate: { gte: from, lte: to },
      deletedAt: null,
    },
    orderBy: [{ entryDate: "desc" }, { contractorId: "asc" }, { trade: "asc" }],
    include: MANPOWER_INCLUDE,
  });
  return NextResponse.json({ entries });
}

/** POST /api/manpower-entries — site engineer logs actual headcount. Upserts on
 *  (projectId, contractorId, trade, entryDate) so a resubmit updates instead
 *  of duplicating.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Your account can't log manpower." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostManpowerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, contractorId, trade, entryDate, actualCount, notes } = body;
  const count = Math.floor(actualCount);
  const day = entryDate ? new Date(entryDate + "T00:00:00Z") : (() => {
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    return t;
  })();
  const cleanNotes = (notes ?? "").trim();
  const idempotencyKey = readIdempotencyKey(body);

  // Verify contractor belongs to project.
  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, projectId },
    select: { id: true, name: true },
  });
  if (!contractor) return NextResponse.json({ error: "Contractor not found on project" }, { status: 404 });

  const entry = await prisma.manpowerEntry.upsert({
    where: {
      projectId_contractorId_trade_entryDate: {
        projectId,
        contractorId,
        trade,
        entryDate: day,
      },
    },
    create: {
      projectId,
      contractorId,
      trade,
      entryDate: day,
      actualCount: count,
      notes: cleanNotes || null,
      createdById: session.user.id,
      idempotencyKey,
    },
    update: {
      actualCount: count,
      notes: cleanNotes || null,
      // NOT updating createdById — the original logger stays; we just record
      // that a later resubmit adjusted the number. If we ever want to know who
      // last edited, add lastUpdatedById as a separate column.
    },
    include: MANPOWER_INCLUDE,
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "UPSERT",
    entityType: "ManpowerEntry",
    entityId: entry.id,
    summary: `Manpower: ${contractor.name} · ${trade} · ${day.toISOString().slice(0, 10)} → ${count}`,
  });

  return NextResponse.json({ entry }, { status: 201 });
}
