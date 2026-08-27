import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { getScorecard } from "@/lib/scorecardServer";
import ScorecardView from "@/components/ScorecardView";
import ReportErrorFallback from "@/components/ReportErrorFallback";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";

/**
 * Site Progress Scorecard — daily report matching Shraddha's existing Colab
 * PDF layout. Route accepts ?date=YYYY-MM-DD (defaults to today). The view
 * component handles the date-picker + print flow.
 *
 * Print → Save-as-PDF from the browser gives pixel-perfect A4 output today;
 * a server-side one-click PDF is a follow-up chunk.
 */
export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;
  const { date: dateParam } = await searchParams;

  const day = (() => {
    if (dateParam) {
      const d = new Date(dateParam + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d;
    }
    return istDayStart();
  })();

  const dateStr = day.toISOString().slice(0, 10);

  let scorecard;
  try {
    scorecard = await getScorecard(projectId, day);
  } catch (err) {
    console.error("[scorecard] failed", err);
    return (
      <ReportErrorFallback
        title="Daily Scorecard could not be generated"
        detail={err instanceof Error ? err.message : String(err)}
        projectId={projectId}
      />
    );
  }
  if (!scorecard) notFound();

  return (
    <ScorecardView scorecard={scorecard} projectId={projectId} dateStr={dateStr} />
  );
}
