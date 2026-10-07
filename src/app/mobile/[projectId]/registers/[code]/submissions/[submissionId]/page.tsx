import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { istDayString } from "@/lib/istDay";
import { formatDayMonthYear, formatDayMonthYearTime } from "@/lib/dates";
import { dueState, parseSnapshot } from "@/lib/registers";
import RegisterTable from "@/components/registers/RegisterTable";
import RegisterSubmissionActions from "@/components/registers/RegisterSubmissionActions";
import SignedPaperPhoto from "@/components/registers/SignedPaperPhoto";
import SubmissionStatusPill from "@/components/registers/SubmissionStatusPill";

export const dynamic = "force-dynamic";

/**
 * One register sign-off (INV-XXXXXXXX). Shows the frozen snapshot in the
 * Excel layout, the decision trail, the optional signed-paper photo and a
 * Print link. The approver (canReview + module, not the preparer) gets
 * Approve / Reject while it's PENDING.
 */
export default async function RegisterSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; code: string; submissionId: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId, code, submissionId } = await params;
  const { submitted } = await searchParams;

  const sub = await prisma.registerSubmission.findUnique({
    where: { id: submissionId },
    include: {
      preparedBy: { select: { id: true, name: true } },
      approvedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      register: { select: { projectId: true, type: { select: { code: true, module: true, dueDateKey: true } } } },
    },
  });
  if (!sub || sub.register.projectId !== projectId || sub.register.type.code !== code) notFound();
  if (!canAccessModule(session.user.modules, sub.register.type.module as ModuleKey)) redirect(`/mobile/${projectId}`);

  const snapshot = parseSnapshot(sub.snapshot);
  if (!snapshot) notFound();

  const iAmPreparer = sub.preparedById === session.user.id;
  const iCanDecide = canReview(session.user.role) && !iAmPreparer;
  const dueKey = sub.register.type.dueDateKey;
  // Overdue is judged as of the sheet date, not today — the frozen sheet
  // shouldn't turn red just because time passed after it was signed.
  const asOfIso = istDayString(sub.asOfDate);
  const overdueCount = dueKey
    ? snapshot.rows.filter((r) => dueState(r.values[dueKey], asOfIso) === "overdue").length
    : 0;
  const listHref = `/mobile/${projectId}/registers/${code}`;

  return (
    <div className="flex flex-col bg-ivory">
      <header
        className="px-4 pt-4 pb-3 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-[22px] leading-tight text-ink tracking-tight">{sub.displayId}</h1>
          <SubmissionStatusPill status={sub.status} />
        </div>
        <p className="text-[12px] text-ink-3 mt-0.5">
          {snapshot.typeName} · as of {formatDayMonthYear(sub.asOfDate)} · {sub.rowCount} item
          {sub.rowCount === 1 ? "" : "s"}
        </p>
      </header>

      <div className="px-4 py-4 space-y-4">
        {submitted && sub.status === "PENDING" && (
          <p role="status" className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800 text-[13px] p-2.5">
            Submitted. The approver has been notified.
          </p>
        )}

        <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5">
          <KV label="Prepared by" value={`${sub.preparedBy.name} · ${formatDayMonthYearTime(sub.createdAt)}`} />
          {sub.approvedBy && sub.approvedAt && (
            <KV label="Approved by" value={`${sub.approvedBy.name} · ${formatDayMonthYearTime(sub.approvedAt)}`} />
          )}
          {sub.rejectedBy && sub.rejectedAt && (
            <KV label="Rejected by" value={`${sub.rejectedBy.name} · ${formatDayMonthYearTime(sub.rejectedAt)}`} />
          )}
          {sub.rejectionReason && <KV label="What needs fixing" value={sub.rejectionReason} emphasis />}
          {sub.remark && <KV label="Note from preparer" value={sub.remark} />}
        </section>

        {overdueCount > 0 && (
          <p className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-800 text-[12px] p-2.5">
            {overdueCount} item{overdueCount === 1 ? " was" : "s were"} past the due date on the sheet date
            (highlighted).
          </p>
        )}

        <RegisterTable columns={snapshot.columns} identifierKey={snapshot.identifierKey} rows={snapshot.rows} dueDateKey={dueKey} todayIso={asOfIso} />

        <SignedPaperPhoto
          submissionId={sub.id}
          projectId={projectId}
          url={sub.signedPaperUrl}
          canEdit={iAmPreparer || canReview(session.user.role)}
        />

        <Link
          href={`/print/registers/${sub.id}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-stone-300 text-ink text-[13px] font-semibold px-3 py-2"
        >
          <Printer className="w-4 h-4" />
          Print / Save as PDF
        </Link>

        {sub.status === "REJECTED" && iAmPreparer && (
          <p className="rounded-lg bg-stone-100 ring-1 ring-stone-300 text-stone-700 text-[12px] p-2.5">
            Fix the items on the{" "}
            <Link href={listHref} className="font-semibold text-ferrous-600">
              register
            </Link>{" "}
            and submit again.
          </p>
        )}
      </div>

      {sub.status === "PENDING" && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          {iCanDecide ? (
            <RegisterSubmissionActions
              submissionId={sub.id}
              expectedUpdatedAt={sub.updatedAt.toISOString()}
              backHref={`${listHref}?tab=signoffs`}
            />
          ) : (
            <p className="rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-xs p-2.5 text-center">
              Waiting for the approver to sign this off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className={`text-[14px] leading-snug ${emphasis ? "text-red-800 font-semibold" : "text-ink"}`}>{value}</p>
    </div>
  );
}
