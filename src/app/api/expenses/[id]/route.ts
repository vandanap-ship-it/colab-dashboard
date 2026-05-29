import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canApproveExpense, canLogExpense, isAdmin } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { allowedExpenseTransition, normalizeCategory, parseAmount } from "@/lib/expenses";
import { badRequest, forbidden, handleApiError, notFound, unauthorized } from "@/lib/apiErrors";

const expenseInclude = {
  loggedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  photos: { select: { id: true, url: true } },
} as const;

function canViewExpenses(role: string, modules: string | null): boolean {
  return !isScopedUser(modules) && (canLogExpense(role) || canApproveExpense(role));
}

export async function GET(_req: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canViewExpenses(session.user.role, session.user.modules)) return forbidden();

  const { id } = await ctx.params;
  const expense = await prisma.expense.findUnique({ where: { id }, include: expenseInclude });
  if (!expense) return notFound();
  return NextResponse.json({ expense });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, projectId: true, status: true, loggedById: true, description: true },
  });
  if (!expense) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const { status: newStatus, rejectionReason, category, description, amount, date, paidTo, notes } =
    (body ?? {}) as {
      status?: string;
      rejectionReason?: string;
      category?: string;
      description?: string;
      amount?: number;
      date?: string;
      paidTo?: string;
      notes?: string;
    };

  const role = session.user.role;
  const isLogger = expense.loggedById === session.user.id;

  try {
    // ---- Status transition (approve / reject / resubmit) ----
    if (typeof newStatus === "string" && newStatus !== expense.status) {
      const kind = allowedExpenseTransition(expense.status, newStatus);
      if (!kind) return badRequest(`Cannot move an expense from ${expense.status} to ${newStatus}`);
      if (kind === "approve" && !canApproveExpense(role)) return forbidden();
      // Only the logger (or an admin) can resubmit a rejected expense.
      if (kind === "resubmit" && !(isLogger || isAdmin(role))) return forbidden();

      const data: {
        status: string;
        approvedById?: string | null;
        approvedAt?: Date | null;
        rejectionReason?: string | null;
      } = { status: newStatus };
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
      if (newStatus === "SUBMITTED") {
        data.approvedById = null;
        data.approvedAt = null;
        data.rejectionReason = null;
      }

      const updated = await prisma.expense.update({ where: { id }, data, include: expenseInclude });
      await recordAudit({
        projectId: expense.projectId,
        userId: session.user.id,
        action: "STATUS_CHANGE",
        entityType: "Expense",
        entityId: id,
        summary: `Expense "${expense.description.slice(0, 40)}" -> ${newStatus}${
          newStatus === "REJECTED" && data.rejectionReason ? ` (${data.rejectionReason.slice(0, 50)})` : ""
        }`,
      });
      return NextResponse.json({ expense: updated });
    }

    // ---- Content edit (the logger or an approver, while not yet approved) ----
    if (!(isLogger || canApproveExpense(role))) return forbidden();
    if (expense.status === "APPROVED") return badRequest("Approved expenses can't be edited");

    const data: {
      category?: string;
      description?: string;
      amount?: number;
      date?: Date;
      paidTo?: string | null;
      notes?: string | null;
    } = {};
    if (category !== undefined) data.category = normalizeCategory(category);
    if (description !== undefined) {
      const d = description.trim();
      if (d.length < 2) return badRequest("Description too short");
      data.description = d;
    }
    if (amount !== undefined) {
      const a = parseAmount(amount);
      if (a === null) return badRequest("Amount must be greater than 0");
      data.amount = a;
    }
    if (date !== undefined) {
      const d = new Date(date);
      if (isNaN(d.getTime())) return badRequest("Invalid date");
      data.date = d;
    }
    if (paidTo !== undefined) data.paidTo = paidTo.trim() || null;
    if (notes !== undefined) data.notes = notes.trim() || null;

    if (Object.keys(data).length === 0) return badRequest("Nothing to update");

    const updated = await prisma.expense.update({ where: { id }, data, include: expenseInclude });
    await recordAudit({
      projectId: expense.projectId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Expense",
      entityId: id,
      summary: `Expense "${expense.description.slice(0, 40)}" updated`,
    });
    return NextResponse.json({ expense: updated });
  } catch (e) {
    return handleApiError(e, "PATCH /api/expenses/:id");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const { id } = await ctx.params;
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, projectId: true, status: true, loggedById: true },
  });
  if (!expense) return notFound();

  // The logger or an admin may trash it — but not once it's approved.
  if (!(expense.loggedById === session.user.id || isAdmin(session.user.role))) return forbidden();
  if (expense.status === "APPROVED") return badRequest("Approved expenses can't be deleted");

  try {
    await prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      projectId: expense.projectId,
      userId: session.user.id,
      action: "DELETE",
      entityType: "Expense",
      entityId: id,
      summary: "Expense moved to trash",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e, "DELETE /api/expenses/:id");
  }
}
