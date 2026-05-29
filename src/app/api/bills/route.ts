import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canApproveBill, canPrepareBill } from "@/lib/roles";
import {
  cleanLines,
  parseBillDate,
  parseTaxPercent,
  withTotals,
  type BillLineInput,
} from "@/lib/billing";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { badRequest, forbidden, unauthorized } from "@/lib/apiErrors";

/** Anyone in the billing flow (preparer or approver) may view bills. */
function canViewBills(role: string): boolean {
  return canPrepareBill(role) || canApproveBill(role);
}

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
  if (!canViewBills(session.user.role)) return NextResponse.json({ bills: [] });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  if (!projectId) return badRequest("projectId required");

  const where: { projectId: string; status?: string } = { projectId };
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const { projectId, contractorId, title, periodStart, periodEnd, notes, taxPercent, lines } =
    (body ?? {}) as {
      projectId?: string;
      contractorId?: string;
      title?: string;
      periodStart?: string;
      periodEnd?: string;
      notes?: string;
      taxPercent?: number;
      lines?: BillLineInput[];
    };

  if (!projectId) return badRequest("projectId required");
  if (!contractorId) return badRequest("contractorId required");
  const t = (title ?? "").trim();
  if (t.length < 3) return badRequest("Title too short");

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
