import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessBilling, canPrepareBill } from "@/lib/roles";
import {
  cleanLines,
  parseBillDate,
  parseTaxPercent,
  withTotals,
} from "@/lib/billing";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { badRequest, forbidden, unauthorized } from "@/lib/apiErrors";
import { parseBody } from "@/lib/parseBody";

const BillLineSchema = z.object({
  type: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  wbsNodeId: z.string().min(1).nullable().optional(),
  quantity: z.number().finite().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  rate: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
});

const PostBillSchema = z.object({
  projectId: z.string().min(1),
  contractorId: z.string().min(1),
  title: z.string().min(3).max(200),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  notes: z.string().max(2000).optional(),
  taxPercent: z.number().finite().min(0).max(100).optional(),
  lines: z.array(BillLineSchema).max(200).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const billInclude = {
  contractor: { select: { id: true, name: true } },
  preparedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lineItems: { orderBy: { orderIndex: "asc" as const } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  // Scoped contractors and site engineers don't see billing at all.
  if (!canAccessBilling(session.user.role)) return NextResponse.json({ bills: [] });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return badRequest("projectId required");

  const where: { projectId: string; status?: string; deletedAt: null } = { projectId, deletedAt: null };
  if (status) where.status = status;

  const bills = await prisma.subContractorBill.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: billInclude,
  });
  return NextResponse.json({ bills: bills.map(withTotals) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canPrepareBill(session.user.role)) {
    return forbidden("Your account can't prepare bills.");
  }

  const parsed = await parseBody(req, PostBillSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, contractorId, title, periodStart, periodEnd, notes, taxPercent, lines } = body;
  const t = title.trim();

  // The contractor must belong to this project (no cross-project bills).
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    select: { projectId: true },
  });
  if (!contractor || contractor.projectId !== projectId) {
    return badRequest("Invalid contractor for this project");
  }

  const cleaned = cleanLines(lines);
  const tax = parseTaxPercent(taxPercent);
  const idempotencyKey = readIdempotencyKey(body);

  const { record: bill, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.subContractorBill.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: billInclude }),
    () =>
      prisma.subContractorBill.create({
        data: {
          projectId,
          contractorId,
          title: t,
          periodStart: parseBillDate(periodStart),
          periodEnd: parseBillDate(periodEnd),
          notes: notes?.trim() || null,
          taxPercent: tax,
          status: "DRAFT",
          preparedById: session.user.id,
          idempotencyKey,
          lineItems: cleaned.length > 0 ? { create: cleaned } : undefined,
        },
        include: billInclude,
      }),
  );

  if (!duplicate) {
    const { total } = withTotals(bill);
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "SubContractorBill",
      entityId: bill.id,
      summary: `Bill drafted: "${t}" (${cleaned.length} item${cleaned.length === 1 ? "" : "s"}, total ${total})`,
    });
  }

  return NextResponse.json({ bill: withTotals(bill) }, { status: duplicate ? 200 : 201 });
}
