import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { getWeeklyReport } from "@/lib/weeklyReportServer";
import WeeklyReportView from "@/components/WeeklyReportView";
import ReportErrorFallback from "@/components/ReportErrorFallback";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";

/**
 * Weekly Site Progress Report — matches the Amanvana Aug 17-23 PDF format
 * Shraddha shared. Route: /projects/[id]/reports/weekly?weekEnding=YYYY-MM-DD
 * (defaults to the most recent Sunday).
 *
 * Print → Save as PDF from the browser for the export flow.
 */
export default async function WeeklyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weekEnding?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id: projectId } = await params;
  const { weekEnding: qsWeek } = await searchParams;

  const weekEnd = (() => {
    if (qsWeek) {
      const d = new Date(qsWeek + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d;
    }
    // Default to most recent Sunday, anchored to IST calendar so late-night
    // opens don't roll back a day.
    const t = istDayStart();
    const dow = t.getUTCDay(); // 0 = Sunday (UTC midnight represents an IST date)
    if (dow !== 0) t.setUTCDate(t.getUTCDate() - dow);
    return t;
  })();

  let report;
  try {
    report = await getWeeklyReport(projectId, weekEnd);
  } catch (err) {
    console.error("[weekly] failed", err);
    return (
      <ReportErrorFallback
        title="Weekly Report could not be generated"
        detail={err instanceof Error ? err.message : String(err)}
        projectId={projectId}
      />
    );
  }
  if (!report) notFound();

  return (
    <WeeklyReportView report={report} projectId={projectId} weekEndingStr={weekEnd.toISOString().slice(0, 10)} />
  );
}
