// ---------------------------------------------------------------------------
// Weekly executive email — Vercel Cron endpoint.
//
// Fires at 07:00 IST every Friday (01:30 UTC Fri, per vercel.json). For every
// active project the app knows about, computes the weekly report, distills
// the numbers, and mails leadership a one-glance summary linking back to the
// full desktop report.
//
// Recipient set: `DEFAULT_RECIPIENTS` from src/lib/email.ts (product owner list).
// A follow-up can add a per-user `receivesWeeklyReport` flag mirroring the
// daily-tasks pattern; this ships against the existing list so leadership
// starts getting the roll-up without a schema migration.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_RECIPIENTS, sendEmail, weeklyReportEmail } from "@/lib/email";
import { getWeeklyReport } from "@/lib/weeklyReportServer";
import { reasonLabel } from "@/lib/hindranceReasons";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "https://siddhi-whitelotus.vercel.app";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function GET(req: NextRequest) {
  // Same fail-closed auth as the other cron endpoints — the Vercel cron
  // scheduler adds Authorization: Bearer <CRON_SECRET>. Reject anything
  // else so this can't be hit as a public URL.
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this deployment." },
      { status: 503 },
    );
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = istDayStart();
  // "Week ending" is the Friday the cron fires on — Vercel schedules
  // Friday 01:30 UTC = Friday 07:00 IST, so today IS Friday already.
  // No shift needed; getWeeklyReport walks back 6 days from weekEnding.
  const weekEnd = today;

  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  const results: Array<{ projectId: string; ok: boolean; reason?: string }> = [];

  for (const p of projects) {
    try {
      const report = await getWeeklyReport(p.id, weekEnd);
      if (!report) {
        results.push({ projectId: p.id, ok: false, reason: "no report data" });
        continue;
      }

      // Milestone counts across all contractors — sum totals so leadership
      // sees one number per bucket rather than per-contractor rows.
      let completed = 0;
      let started = 0;
      let notStarted = 0;
      let overdue = 0;
      for (const plan of report.milestonePlans) {
        completed += plan.toComplete.closed;
        started += plan.toStart.started;
        notStarted += plan.toStart.notStartedItems.length;
        overdue += plan.overdue.total;
      }

      const byContractor = report.manpowerByContractor
        .filter((c) => c.weeklyPlanned > 0 || c.weeklyActual > 0)
        .sort((a, b) => a.contractorName.localeCompare(b.contractorName))
        .map((c) => ({
          name: c.contractorName,
          weeklyPlanned: c.weeklyPlanned,
          weeklyActual: c.weeklyActual,
          pctOfPlan: c.pctOfPlan,
        }));

      // Delay reasons — top 3 by daysImpact. The report already aggregates
      // and de-dupes; we just cap and label.
      const topDelayReasons = [...report.delayReasons]
        .sort((a, b) => b.daysImpact - a.daysImpact)
        .slice(0, 3)
        .map((r) => ({
          label: reasonLabel(r.code) || r.label,
          count: r.activityCount,
          daysImpact: r.daysImpact,
        }));

      const email = weeklyReportEmail({
        to: DEFAULT_RECIPIENTS,
        projectName: report.project.name,
        weekEndLabel: fmtDate(report.weekEnd),
        plannedPct: report.overall.plannedPct,
        actualPct: report.overall.actualPct,
        variancePct: report.overall.variancePct,
        manpowerActual: report.manpowerSiteTotal.weeklyActual,
        manpowerPlanned: report.manpowerSiteTotal.weeklyPlanned,
        manpowerPctOfPlan: report.manpowerSiteTotal.pctOfPlan,
        milestones: { completed, started, notStarted, overdue },
        byContractor,
        topDelayReasons,
        reportUrl: `${SIDDHI_BASE_URL}/projects/${p.id}/reports/weekly`,
      });

      const send = await sendEmail(email);
      results.push({ projectId: p.id, ok: send.ok, reason: send.error });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/weekly-report] ${p.id} failed:`, msg);
      results.push({ projectId: p.id, ok: false, reason: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    weekEnd: weekEnd.toISOString().slice(0, 10),
    results,
  });
}
