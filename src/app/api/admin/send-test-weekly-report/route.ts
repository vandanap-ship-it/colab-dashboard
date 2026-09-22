// ---------------------------------------------------------------------------
// Admin-triggered PREVIEW send of the weekly executive email.
//
// Runs the same computation the Friday 07:00 IST cron runs, but sends the
// mail ONLY to the caller's own email (from the auth session). Lets an
// admin eyeball the layout without waiting for Friday, without touching
// the production recipient list, and without needing CRON_SECRET.
//
// Session-auth + admin only. GET so it's dead simple from the browser bar:
//   /api/admin/send-test-weekly-report?projectId=<id>
// while signed in as admin, and the mail lands in your inbox.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { sendEmail, weeklyReportEmail } from "@/lib/email";
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
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!session.user.email) {
    return NextResponse.json({ error: "Your account has no email on file — set one first." }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Reuse today's IST-anchored week end — same rule the cron uses. Testing
  // any older week can be added later; the point of the preview is "will
  // this look right when it lands this Friday", not "backfill history".
  const weekEnd = istDayStart();
  const report = await getWeeklyReport(projectId, weekEnd);
  if (!report) return NextResponse.json({ error: "No weekly report data for this project." }, { status: 404 });

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
  const topDelayReasons = [...report.delayReasons]
    .sort((a, b) => b.daysImpact - a.daysImpact)
    .slice(0, 3)
    .map((r) => ({
      label: reasonLabel(r.code) || r.label,
      count: r.activityCount,
      daysImpact: r.daysImpact,
    }));

  const email = weeklyReportEmail({
    to: session.user.email,
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
    reportUrl: `${SIDDHI_BASE_URL}/projects/${projectId}/reports/weekly`,
  });
  const send = await sendEmail(email);

  return NextResponse.json({
    ok: send.ok,
    skipped: send.skipped ?? false,
    to: session.user.email,
    projectId,
    weekEnd: report.weekEnd.toISOString().slice(0, 10),
    error: send.error ?? null,
  });
}
