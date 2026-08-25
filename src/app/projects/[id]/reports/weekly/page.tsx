import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { getWeeklyReport } from "@/lib/weeklyReportServer";
import WeeklyReportView from "@/components/WeeklyReportView";

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

  const { id: projectId } = await params;
  const { weekEnding: qsWeek } = await searchParams;

  const weekEnd = (() => {
    if (qsWeek) {
      const d = new Date(qsWeek + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d;
    }
    // Default to most recent Sunday (UTC).
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    const dow = t.getUTCDay(); // 0 = Sunday
    if (dow !== 0) t.setUTCDate(t.getUTCDate() - dow);
    return t;
  })();

  const report = await getWeeklyReport(projectId, weekEnd);
  if (!report) notFound();

  return (
    <WeeklyReportView report={report} projectId={projectId} weekEndingStr={weekEnd.toISOString().slice(0, 10)} />
  );
}
