import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { formatDayMonthYear } from "@/lib/dates";
import { parseSnapshot } from "@/lib/registers";
import RegisterTable from "@/components/registers/RegisterTable";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/**
 * Print view of one register sign-off, laid out like the safety team's
 * Excel form ("03 (b). Checklist - Inventory of Fire Extinguisher.xlsx"):
 * title + project, sheet date, the table, and the Prepared By / Reviewed
 * & Approved By footer with names and dates filled in from Siddhi.
 * Rendered from the frozen snapshot, so a reprint months later matches
 * what was signed. Lives outside /mobile so no app chrome prints.
 */
export default async function PrintRegisterSubmission({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { submissionId } = await params;

  const sub = await prisma.registerSubmission.findUnique({
    where: { id: submissionId },
    include: {
      preparedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      register: { select: { type: { select: { module: true } } } },
    },
  });
  if (!sub) notFound();
  if (!canAccessModule(session.user.modules, sub.register.type.module as ModuleKey)) notFound();
  const snap = parseSnapshot(sub.snapshot);
  if (!snap) notFound();

  const approved = sub.status === "APPROVED";

  return (
    <div className="bg-white text-black min-h-screen">
      <style>{`@page { size: A4 portrait; margin: 14mm; }`}</style>
      <div className="max-w-[800px] mx-auto px-6 py-6 print:p-0">
        <div className="flex justify-end mb-4 print:hidden">
          <PrintButton />
        </div>

        {!approved && (
          <p className="mb-3 border-2 border-black text-center font-bold tracking-widest text-[12px] py-1">
            {sub.status === "PENDING" ? "DRAFT — AWAITING SIGN-OFF" : "REJECTED — NOT A VALID RECORD"}
          </p>
        )}

        <table className="w-full border-collapse mb-0">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-2 text-center font-bold text-[14px] tracking-wide" colSpan={2}>
                {snap.typeName.toUpperCase()}
              </td>
              <td className="border border-black px-2 py-2 text-center font-bold text-[13px] w-40">{snap.projectName}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 text-[12px]" colSpan={2}>
                <b>Project:</b> {snap.projectName}
              </td>
              <td className="border border-black px-2 py-1.5 text-[12px]">
                <b>Date:</b> {formatDayMonthYear(sub.asOfDate)}
              </td>
            </tr>
          </tbody>
        </table>

        <RegisterTable columns={snap.columns} identifierKey={snap.identifierKey} rows={snap.rows} variant="print" />

        <table className="w-full border-collapse mt-0">
          <tbody>
            <tr>
              <FooterCell label="Prepared By" value={sub.preparedBy.name} />
              <FooterCell label="Reviewed & Approved By" value={approved ? sub.approvedBy?.name ?? "" : ""} />
            </tr>
            <tr>
              <FooterCell label="Prepared Date" value={formatDayMonthYear(sub.createdAt)} />
              <FooterCell label="Date" value={approved && sub.approvedAt ? formatDayMonthYear(sub.approvedAt) : ""} />
            </tr>
            <tr>
              <FooterCell label="Signature" value={approved ? "Signed electronically in Siddhi" : ""} tall />
              <FooterCell label="Signature" value={approved ? "Approved electronically in Siddhi" : ""} tall />
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 text-[11px] text-center">
                ({snap.preparedByLabel ?? "Prepared by"})
              </td>
              <td className="border border-black px-2 py-1 text-[11px] text-center">
                ({snap.approvedByLabel ?? "Approved by"})
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3 text-[10px] text-stone-600">
          {sub.displayId} · {snap.rows.length} item{snap.rows.length === 1 ? "" : "s"} · generated from Siddhi on{" "}
          {formatDayMonthYear(new Date())}
        </p>
      </div>
    </div>
  );
}

function FooterCell({ label, value, tall }: { label: string; value: string; tall?: boolean }) {
  return (
    <td className={`border border-black px-2 ${tall ? "py-4" : "py-1.5"} text-[12px] w-1/2 align-top`}>
      <b>{label}:</b> {value}
    </td>
  );
}
