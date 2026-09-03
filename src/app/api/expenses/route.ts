import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canApproveExpense, canLogExpense } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { normalizeCategory, parseAmount } from "@/lib/expenses";
import { createIdempotent, readIdempotencyKey } from "@/lib/idempotency";
import { badRequest, forbidden, unauthorized } from "@/lib/apiErrors";
import { parseBody, zDateString } from "@/lib/parseBody";

const PostExpenseSchema = z.object({
  projectId: z.string().min(1),
  category: z.string().max(60).optional(),
  description: z.string().min(2, "Description too short").max(500),
  amount: z.number().finite().positive().max(100_000_000),
  date: zDateString.optional(),
  paidTo: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

/**
 * Any internal member who can log or approve may view expenses. Scoped external
 * contractors are excluded entirely — project P2P is internal-only.
 */
function canViewExpenses(role: string, modules: string | null): boolean {
  return !isScopedUser(modules) && (canLogExpense(role) || canApproveExpense(role));
}

export const expenseInclude = {
  loggedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  photos: { select: { id: true, url: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canViewExpenses(session.user.role, session.user.modules)) return NextResponse.json({ expenses: [] });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  if (!projectId) return badRequest("projectId required");

  const where: { projectId: string; status?: string; category?: string; deletedAt: null } = { projectId, deletedAt: null };
  if (status) where.status = status;
  if (category) where.category = category;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
    include: expenseInclude,
  });
  return NextResponse.json({ expenses });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (isScopedUser(session.user.modules) || !canLogExpense(session.user.role)) {
    return forbidden("Your account can't log expenses.");
  }

  const parsed = await parseBody(req, PostExpenseSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const { projectId, category, description, amount, date, paidTo, notes, photoUrls } = body;
  const desc = description.trim();
  const amt = parseAmount(amount) ?? amount; // parseAmount enforces round + non-null; amount is already positive per zod
  const when = date ? new Date(date) : new Date();
  const photos = (photoUrls ?? []).slice(0, 6);
  const idempotencyKey = readIdempotencyKey(body);

  const { record: expense, duplicate } = await createIdempotent(
    idempotencyKey,
    () => prisma.expense.findUnique({ where: { idempotencyKey: idempotencyKey! }, include: expenseInclude }),
    () =>
      prisma.expense.create({
        data: {
          projectId,
          category: normalizeCategory(category),
          description: desc,
          amount: amt,
          date: when,
          paidTo: paidTo?.trim() || null,
          notes: notes?.trim() || null,
          status: "SUBMITTED",
          loggedById: session.user.id,
          idempotencyKey,
          photos: photos.length > 0 ? { create: photos.map((url) => ({ url })) } : undefined,
        },
        include: expenseInclude,
      }),
  );

  if (!duplicate) {
    await recordAudit({
      projectId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Expense",
      entityId: expense.id,
      summary: `Expense logged: ${expense.category} ${amt} (${desc.length > 50 ? desc.slice(0, 50) + "…" : desc})`,
    });
  }

  return NextResponse.json({ expense }, { status: duplicate ? 200 : 201 });
}
