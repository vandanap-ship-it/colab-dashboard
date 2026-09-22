import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar, IndianRupee, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canLogExpense, canApproveExpense } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import MobileExpenseActions from "@/components/mobile/MobileExpenseActions";

export const dynamic = "force-dynamic";

type ExpenseStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

/**
 * Mobile Expense detail — matches the Issue / Concern / Hindrance / Permit
 * shape. Status pill, category eyebrow, Fraunces description, headline
 * amount tile, meta card (logger, approver, paid to, date, notes), photos,
 * rejection reason card when rejected, sticky action bar.
 */
export default async function MobileExpenseDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (isScopedUser(session.user.modules)) redirect(`/mobile/${projectId}`);
  if (!(canLogExpense(session.user.role) || canApproveExpense(session.user.role))) {
    redirect(`/mobile/${projectId}`);
  }

  const expense = await prisma.expense.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      loggedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!expense) notFound();

  const iAmLogger = expense.loggedById === session.user.id;
  const iCanApprove = canApproveExpense(session.user.role);
  const showBar =
    (iCanApprove && expense.status === "SUBMITTED") ||
    (iAmLogger && expense.status === "REJECTED");

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold uppercase tracking-[0.14em]">
          <StatusPill status={expense.status} />
          <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold text-[9.5px]">
            {expense.category}
          </span>
        </div>
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {expense.description}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Amount — the number is the point of an expense; give it its own
            tile in Fraunces so leadership scans instantly. */}
        <section className="rounded-2xl border border-sandstone-100 bg-cream p-5">
          <div className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
            Amount
          </div>
          <div className="mt-1 flex items-baseline gap-1 text-ferrous-700">
            <IndianRupee className="w-6 h-6" />
            <span
              className="font-serif tabular-nums"
              style={{ fontSize: "40px", lineHeight: "1", letterSpacing: "-0.02em" }}
            >
              {fmtInr(expense.amount)}
            </span>
          </div>
        </section>

        {/* Meta */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Logged by</span>
            <span className="font-medium">{expense.loggedBy.name}</span>
          </div>
          {expense.paidTo && (
            <div className="flex items-center gap-2 text-stone-700">
              <Wallet className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Paid to</span>
              <span className="font-medium">{expense.paidTo}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
            <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Date</span>
            <span className="font-medium">{fmtDate(expense.date)}</span>
          </div>
          {expense.approvedBy && expense.approvedAt && (
            <div className={`flex items-center gap-2 pt-2 border-t border-stone-100 mt-2 ${expense.status === "APPROVED" ? "text-emerald-800" : "text-red-800"}`}>
              <UserIcon className={`w-4 h-4 shrink-0 ${expense.status === "APPROVED" ? "text-emerald-600" : "text-red-600"}`} />
              <span className={`text-xs uppercase tracking-wider mr-1 ${expense.status === "APPROVED" ? "text-emerald-700/70" : "text-red-700/70"}`}>
                {expense.status === "APPROVED" ? "Approved by" : "Rejected by"}
              </span>
              <span className="font-medium">{expense.approvedBy.name}</span>
              <span className="text-xs opacity-70 ml-auto">{fmtDate(expense.approvedAt)}</span>
            </div>
          )}
        </section>

        {expense.notes && (
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
              Notes
            </div>
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
              {expense.notes}
            </p>
          </section>
        )}

        {expense.status === "REJECTED" && expense.rejectionReason && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-[10px] font-semibold text-red-800 uppercase tracking-wider mb-1">
              Why rejected
            </div>
            <p className="text-sm text-red-900 leading-snug">{expense.rejectionReason}</p>
          </section>
        )}

        {expense.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Receipts · {expense.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {expense.photos.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200 block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      {showBar && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          <MobileExpenseActions
            expenseId={expense.id}
            currentStatus={expense.status as ExpenseStatus}
            expectedUpdatedAt={expense.updatedAt.toISOString()}
            projectId={projectId}
            iCanApprove={iCanApprove}
            iAmLogger={iAmLogger}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    SUBMITTED: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Submitted" },
    APPROVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Approved" },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected" },
  };
  const cfg = map[status] ?? map.SUBMITTED;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtInr(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString("en-IN");
  return n.toFixed(2);
}
