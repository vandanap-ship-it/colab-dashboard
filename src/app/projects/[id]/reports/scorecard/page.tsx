import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { getScorecard } from "@/lib/scorecardServer";
import ScorecardView from "@/components/ScorecardView";

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
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    return t;
  })();

  const scorecard = await getScorecard(projectId, day);
  if (!scorecard) notFound();

  const dateStr = day.toISOString().slice(0, 10);

  return (
    <ScorecardView scorecard={scorecard} projectId={projectId} dateStr={dateStr} />
  );
}
