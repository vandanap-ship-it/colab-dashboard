// ---------------------------------------------------------------------------
// Weekly straggler nudge — Vercel Cron endpoint.
//
// Fires Monday 09:30 IST (04:00 UTC per vercel.json). For every active
// site-team raiser who hasn't raised anything on any adoption-tracked
// surface in the last 7 days, send a push + inbox row inviting them
// back into Siddhi. Pairs with the /adoption dashboard's leaderboard
// (humans spot the gap; the cron closes it).
//
// Who gets scanned:
//   • role in SITE_ENGINEER | SITE_MANAGER (admins / planners / product
//     are oversight, not raisers — scanning them generates noise)
//   • active = true
//   • canApproveWorkPermits = false (designated approvers, e.g. Girish,
//     Mohd Asif — their job is to approve, not to raise. Don't nudge
//     them for inactivity on the raise side.)
//   • createdAt > 3 days ago (grace period for brand-new accounts
//     who haven't had a day on site yet)
//
// What counts as "activity":
//   ProgressEntry, ManpowerEntry, Inspection, WorkPermit, SafetyInduction,
//   Issue — any row the user created in the last 7 days.
//
// Idempotent via tag `weekly-stragglers-YYYY-Www` on sendPushToUser;
// re-firing the cron inside the same ISO week replaces the prior
// inbox row rather than stacking a second one.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** ISO week key YYYY-Www. Used as the push tag so the inbox stays
 *  single-row-per-week per user. */
function isoWeekTag(d: Date): string {
  const t = new Date(d);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  // Same fail-closed CRON_SECRET pattern as every other cron endpoint.
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

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - WEEK_MS);
  const graceCutoff = new Date(now.getTime() - GRACE_MS);
  const weekTag = `weekly-stragglers-${isoWeekTag(now)}`;

  // Pick the project that actually has a schedule loaded — same
  // guard the daily nudge uses. If more than one project ever ships,
  // this becomes a loop; for now Amanvana is the only live one.
  const projects = await prisma.project.findMany({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });
  const primaryProject = projects[0];
  if (!primaryProject) {
    return NextResponse.json({ skipped: "no active projects", sentTo: 0 });
  }

  // Candidate pool.
  const candidates = await prisma.user.findMany({
    where: {
      active: true,
      canApproveWorkPermits: false,
      role: { in: ["SITE_ENGINEER", "SITE_MANAGER"] },
      createdAt: { lt: graceCutoff },
    },
    select: { id: true, name: true, username: true, createdAt: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ skipped: "no eligible users", sentTo: 0 });
  }

  // Find anyone in the pool who HAS activity in the last 7 days on
  // any of the six surfaces. One findFirst per surface keyed by
  // createdById IN (candidateIds) + createdAt >= sevenDaysAgo. The
  // query planner uses the composite indexes we already have on each
  // model. We collect every active-raiser id into a Set, then
  // subtract from the candidate pool to get the straggler list.
  const candidateIds = candidates.map((u) => u.id);
  const commonWhere = {
    createdAt: { gte: sevenDaysAgo },
    deletedAt: null,
  };

  const [progress, manpower, inspections, permits, inductions, observations] = await Promise.all([
    prisma.progressEntry.findMany({
      where: { ...commonWhere, createdById: { in: candidateIds } },
      select: { createdById: true },
      distinct: ["createdById"],
    }),
    prisma.manpowerEntry.findMany({
      where: { ...commonWhere, createdById: { in: candidateIds } },
      select: { createdById: true },
      distinct: ["createdById"],
    }),
    prisma.inspection.findMany({
      where: { ...commonWhere, filledById: { in: candidateIds } },
      select: { filledById: true },
      distinct: ["filledById"],
    }),
    prisma.workPermit.findMany({
      where: { ...commonWhere, requesterId: { in: candidateIds } },
      select: { requesterId: true },
      distinct: ["requesterId"],
    }),
    prisma.safetyInduction.findMany({
      where: { ...commonWhere, createdById: { in: candidateIds } },
      select: { createdById: true },
      distinct: ["createdById"],
    }),
    prisma.issue.findMany({
      where: { ...commonWhere, createdById: { in: candidateIds } },
      select: { createdById: true },
      distinct: ["createdById"],
    }),
  ]);

  const activeIds = new Set<string>();
  for (const r of progress) activeIds.add(r.createdById);
  for (const r of manpower) activeIds.add(r.createdById);
  for (const r of inspections) activeIds.add(r.filledById);
  for (const r of permits) activeIds.add(r.requesterId);
  for (const r of inductions) activeIds.add(r.createdById);
  for (const r of observations) activeIds.add(r.createdById);

  const stragglers = candidates.filter((u) => !activeIds.has(u.id));
  if (stragglers.length === 0) {
    return NextResponse.json({
      ranAt: now.toISOString(),
      candidatesChecked: candidates.length,
      stragglers: 0,
      sentTo: 0,
    });
  }

  let sentTo = 0;
  const perUser: { userId: string; name: string; sent: number; pruned: number }[] = [];
  for (const u of stragglers) {
    const outcome = await sendPushToUser(u.id, {
      title: "Siddhi misses you",
      body: "Nothing logged in the last 7 days. Tap to open and raise today's work.",
      url: `/mobile/${primaryProject.id}`,
      tag: weekTag,
    });
    perUser.push({ userId: u.id, name: u.name, sent: outcome.sent, pruned: outcome.pruned });
    if (outcome.sent > 0) sentTo += 1;
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    weekTag,
    candidatesChecked: candidates.length,
    stragglers: stragglers.length,
    stragglerNames: stragglers.map((u) => u.name),
    sentTo,
    perUser,
  });
}
