import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Printer, Send } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeDesktop } from "@/lib/roles";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { istDayString } from "@/lib/istDay";
import { formatDayMonthYear } from "@/lib/dates";
import { dueState } from "@/lib/registers";
import { getRegisterType, loadRegisterOverview } from "@/lib/registersServer";
import Navbar from "@/components/Navbar";
import RegisterGrid from "@/components/registers/RegisterGrid";
import SubmissionStatusPill from "@/components/registers/SubmissionStatusPill";

export const dynamic = "force-dynamic";

/**
 * Desktop register page — the spreadsheet view for bulk entry from a
 * laptop, plus the sign-off history. Submitting and approving reuse the
 * mobile screens (every internal role can open them), so there's one
 * sign-off flow, not two.
 */
export default async function DesktopRegisterPage({
  params,
}: {
  params: Promise<{ id: string; code: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  const { id: projectId, code } = await params;

  const type = await getRegisterType(code);
  if (!type) notFound();
  if (!canAccessModule(session.user.modules, type.module as ModuleKey)) redirect(`/projects/${projectId}/overview`);

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) notFound();

  const overview = await loadRegisterOverview(projectId, type);
  const todayIso = istDayString();
  const live = overview.rows.filter((r) => !r.retiredAt);
  const overdue = type.dueDateKey ? live.filter((r) => dueState(r.values[type.dueDateKey!], todayIso) === "overdue").length : 0;
  const dueSoon = type.dueDateKey ? live.filter((r) => dueState(r.values[type.dueDateKey!], todayIso) === "due_soon").length : 0;

  const submissions = overview.register
    ? await prisma.registerSubmission.findMany({
        where: { registerId: overview.register.id },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: {
          id: true,
          displayId: true,
          asOfDate: true,
          rowCount: true,
          status: true,
          preparedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          approvedAt: true,
        },
      })
    : [];

  const mobileBase = `/mobile/${projectId}/registers/${code}`;

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-[1800px] mx-auto px-8 py-8 space-y-6">
        <div>
          <Link href={`/projects/${projectId}/safety`} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900">
            ← Back to EHS
          </Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">{type.name}</h1>
              <p className="text-sm text-stone-500 mt-1">
                {project.name} · {live.length} on site · {overdue} overdue · {dueSoon} due in 7 days ·{" "}
                {overview.lastApproved
                  ? `last signed off ${formatDayMonthYear(overview.lastApproved.approvedAt)}`
                  : "not signed off yet"}
              </p>
            </div>
            {overview.pending ? (
              <Link
                href={`${mobileBase}/submissions/${overview.pending.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 text-sm font-medium px-4 py-2"
              >
                {overview.pending.displayId} waiting for sign-off →
              </Link>
            ) : live.length > 0 ? (
              <Link
                href={`${mobileBase}/submit`}
                className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium px-4 py-2"
              >
                <Send className="w-4 h-4" />
                Submit for sign-off
              </Link>
            ) : null}
          </div>
          {overview.signOffDue && !overview.pending && (
            <p className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-900 text-sm px-3 py-2">
              Monthly sign-off is due.
            </p>
          )}
        </div>

        <RegisterGrid
          config={{
            projectId,
            typeCode: type.code,
            shortName: type.shortName,
            columns: type.columns,
            identifierKey: type.identifierKey,
            dueDateKey: type.dueDateKey,
            lastInspectedKey: type.lastInspectedKey,
            defaultIntervalDays: type.defaultIntervalDays,
            villas: overview.villas,
            inspectionTemplateId: overview.inspectionTemplateId,
            todayIso,
          }}
          rows={overview.rows}
        />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-900">Sign-offs</h2>
          {submissions.length === 0 ? (
            <p className="text-sm text-stone-500">No sign-offs yet.</p>
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
              {submissions.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                  <Link href={`${mobileBase}/submissions/${s.id}`} className="font-semibold text-stone-900 hover:underline w-36">
                    {s.displayId}
                  </Link>
                  <SubmissionStatusPill status={s.status} />
                  <span className="text-stone-600">As of {formatDayMonthYear(s.asOfDate)}</span>
                  <span className="text-stone-600">{s.rowCount} items</span>
                  <span className="text-stone-500 flex-1 truncate">
                    By {s.preparedBy.name}
                    {s.approvedBy ? ` · approved by ${s.approvedBy.name} ${formatDayMonthYear(s.approvedAt)}` : ""}
                  </span>
                  <Link
                    href={`/print/registers/${s.id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-stone-600 hover:text-stone-900"
                  >
                    <Printer className="w-4 h-4" />
                    Print
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
