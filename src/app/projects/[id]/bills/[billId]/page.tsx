import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop, canAccessBilling } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import { computeBillTotals } from "@/lib/billing";
import ReportShell, { ReportSection } from "@/components/ReportShell";

const TYPE_LABEL: Record<string, string> = {
  ITEM_RATE: "Item rate",
  LABOUR: "Labour",
  LUMP_SUM: "Lump sum",
};

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: projectId, billId } = await params;
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");
  if (!canAccessBilling(session.user.role)) redirect(`/projects/${projectId}/snapshot`);

  const bill = await prisma.subContractorBill.findUnique({
    where: { id: billId },
    include: {
      contractor: { select: { name: true } },
      preparedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lineItems: { orderBy: { orderIndex: "asc" } },
      project: { select: { id: true, name: true, tagline: true } },
    },
  });
  // Not found, soft-deleted (filtered by the extension), or belongs to another
  // project (IDOR guard) → 404.
  if (!bill || bill.projectId !== projectId) notFound();

  const { subtotal, tax, total } = computeBillTotals(
    bill.lineItems.map((l) => l.amount),
    bill.taxPercent,
  );

  const periodLabel =
    bill.periodStart || bill.periodEnd ? `${fmt(bill.periodStart)} – ${fmt(bill.periodEnd)}` : bill.title;

  return (
    <ReportShell
      projectId={projectId}
      projectName={bill.project.name}
      projectTagline={bill.project.tagline}
      reportTitle="Sub-Contractor Bill"
      periodLabel={periodLabel}
      basePath={`/projects/${projectId}/bills/${billId}`}
      backHref={`/projects/${projectId}/bills`}
      hideDatePicker
    >
      <ReportSection index={1} title={bill.title}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-6">
          <Meta label="Contractor" value={bill.contractor.name} />
          <Meta label="Status" value={bill.status} />
          <Meta label="Prepared by" value={bill.preparedBy?.name ?? "—"} />
          <Meta label="Approved by" value={bill.approvedBy?.name ?? "—"} />
        </div>

        {bill.status === "REJECTED" && bill.rejectionReason && (
          <p className="text-sm text-red-600 mb-4">Rejected: {bill.rejectionReason}</p>
        )}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-left text-[11px] uppercase tracking-wider text-stone-500">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Description</th>
              <th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2">Unit</th>
              <th className="py-2 pr-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lineItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-stone-400 text-center">
                  No line items.
                </td>
              </tr>
            ) : (
              bill.lineItems.map((l, i) => (
                <tr key={l.id} className="border-b border-stone-100">
                  <td className="py-2 pr-2 text-stone-400">{i + 1}</td>
                  <td className="py-2 pr-2 text-stone-800">{l.description || "—"}</td>
                  <td className="py-2 pr-2 text-stone-500">{TYPE_LABEL[l.type] ?? l.type}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{l.quantity ?? "—"}</td>
                  <td className="py-2 pr-2 text-stone-500">{l.unit ?? "—"}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{l.rate != null ? inr(l.rate) : "—"}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{inr(l.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="py-2 text-right text-stone-500">
                Subtotal
              </td>
              <td className="py-2 text-right tabular-nums">{inr(subtotal)}</td>
            </tr>
            {tax > 0 && (
              <tr>
                <td colSpan={6} className="py-1 text-right text-stone-500">
                  Tax{bill.taxPercent ? ` (${bill.taxPercent}%)` : ""}
                </td>
                <td className="py-1 text-right tabular-nums">{inr(tax)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-stone-300">
              <td colSpan={6} className="py-2 text-right font-semibold text-stone-900">
                Total
              </td>
              <td className="py-2 text-right tabular-nums font-semibold text-stone-900">{inr(total)}</td>
            </tr>
          </tfoot>
        </table>

        {bill.notes && (
          <div className="mt-6 text-sm">
            <p className="text-[11px] uppercase tracking-wider text-stone-500">Notes</p>
            <p className="text-stone-700 mt-1">{bill.notes}</p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 text-xs text-stone-500">
          <div>Submitted: {fmt(bill.submittedAt)}</div>
          <div>Approved: {fmt(bill.approvedAt)}</div>
        </div>
      </ReportSection>
    </ReportShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-stone-800 font-medium mt-0.5">{value}</p>
    </div>
  );
}
