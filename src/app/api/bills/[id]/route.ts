import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessBilling, canApproveBill, canPrepareBill } from "@/lib/roles";
import {
  allowedBillTransition,
  cleanLines,
  parseBillDate,
  parseTaxPercent,
  withTotals,
  type BillLineInput,
} from "@/lib/billing";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";

const billInclude = {
  contractor: { select: { id: true, name: true } },
  preparedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lineItems: { orderBy: { orderIndex: "asc" as const } },
} as const;

export async function GET(_req: Request, ctx: RouteContext<"/api/bills/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canAccessBilling(session.user.role)) return forbidden();

  const { id } = await ctx.params;
  const bill = await prisma.subContractorBill.findUnique({ where: { id }, include: billInclude });
  if (!bill) return notFound();
  return NextResponse.json({ bill: withTotals(bill) });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/bills/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const bill = await prisma.subContractorBill.findUnique({
    where: { id },
    select: { id: true, projectId: true, status: true, title: true },
  });
  if (!bill) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const {
    status: newStatus,
    rejectionReason,
    title,
    periodStart,
    periodEnd,
    notes,
    taxPercent,
    lines,
  } = (body ?? {}) as {
    status?: string;
    rejectionReason?: string;
    title?: string;
    periodStart?: string;
    periodEnd?: string;
    notes?: string;
    taxPercent?: number;
    lines?: BillLineInput[];
  };

  try {
    // ---- Status transition (submit / approve / reject / reopen / mark paid) ----
    if (typeof newStatus === "string" && newStatus !== bill.status) {
      const kind = allowedBillTransition(bill.status, newStatus);
      if (!kind) return badRequest(`Cannot move a bill from ${bill.status} to ${newStatus}`);
      if (kind === "prepare" && !canPrepareBill(session.user.role)) return forbidden();
      if (kind === "approve" && !canApproveBill(session.user.role)) return forbidden();

      const data: {
        status: string;
        submittedAt?: Date | null;
        approvedById?: string | null;
        approvedAt?: Date | null;
        rejectionReason?: string | null;
      } = { status: newStatus };
      if (newStatus === "SUBMITTED") data.submittedAt = new Date();
      if (newStatus === "APPROVED") {
        data.approvedById = session.user.id;
        data.approvedAt = new Date();
        data.rejectionReason = null;
      }
      if (newStatus === "REJECTED") {
        data.approvedById = session.user.id;
        data.approvedAt = new Date();
        data.rejectionReason = (rejectionReason ?? "").trim() || null;
      }
      if (newStatus === "DRAFT") {
        // Reopened for edits — clear the approval trail.
        data.submittedAt = null;
        data.approvedById = null;
        data.approvedAt = null;
        data.rejectionReason = null;
      }

      const updated = await prisma.subContractorBill.update({ where: { id }, data, include: billInclude });
      await recordAudit({
        projectId: bill.projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "SubContractorBill",
        entityId: id,
        summary: `Bill "${bill.title}" -> ${newStatus}${
          newStatus === "REJECTED" && data.rejectionReason ? ` (${data.rejectionReason.slice(0, 60)})` : ""
        }`,
      });
      return NextResponse.json({ bill: withTotals(updated) });
    }

    // ---- Content edit (only while DRAFT, preparer only) ----
    if (!canPrepareBill(session.user.role)) return forbidden();
    if (bill.status !== "DRAFT") return badRequest("Only draft bills can be edited");

    const data: {
      title?: string;
      periodStart?: Date | null;
      periodEnd?: Date | null;
      notes?: string | null;
      taxPercent?: number | null;
    } = {};
    if (title !== undefined) {
      const t = title.trim();
      if (t.length < 3) return badRequest("Title too short");
      data.title = t;
    }
    if (periodStart !== undefined) data.periodStart = parseBillDate(periodStart);
    if (periodEnd !== undefined) data.periodEnd = parseBillDate(periodEnd);
    if (notes !== undefined) data.notes = (notes ?? "").trim() || null;
    if (taxPercent !== undefined) data.taxPercent = parseTaxPercent(taxPercent);

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.subContractorBill.update({ where: { id }, data });
      }
      if (Array.isArray(lines)) {
        // Replace the line set so the client's edit is the source of truth.
        await tx.subContractorBillLine.deleteMany({ where: { billId: id } });
        const cleaned = cleanLines(lines);
        if (cleaned.length > 0) {
          await tx.subContractorBillLine.createMany({
            data: cleaned.map((l) => ({ ...l, billId: id })),
          });
        }
      }
    });

    const updated = await prisma.subContractorBill.findUnique({ where: { id }, include: billInclude });
    await recordAudit({
      projectId: bill.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "SubContractorBill",
      entityId: id,
      summary: `Bill "${bill.title}" updated`,
    });
    return NextResponse.json({ bill: updated ? withTotals(updated) : null });
  } catch (e) {
    return handleApiError(e, "PATCH /api/bills/:id");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/bills/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canPrepareBill(session.user.role)) return forbidden();

  const { id } = await ctx.params;
  const bill = await prisma.subContractorBill.findUnique({
    where: { id },
    select: { id: true, projectId: true, status: true },
  });
  if (!bill) return notFound();
  // Only un-approved bills can be trashed, so an approved/paid record can't vanish.
  if (bill.status === "APPROVED" || bill.status === "PAID") {
    return badRequest("Approved or paid bills can't be deleted");
  }

  try {
    await prisma.subContractorBill.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: bill.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "SubContractorBill",
      entityId: id,
      summary: "Bill moved to trash",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/bills/:id");
  }
}
