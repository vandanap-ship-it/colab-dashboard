// ---------------------------------------------------------------------------
// Daily progress-nudge push — Vercel Cron endpoint.
//
// Fires at 11:30 IST Monday to Saturday (06:00 UTC Mon-Sat, per
// vercel.json). For every active SITE_ENGINEER on every project with
// a schedule loaded, checks whether they've logged any ProgressEntry
// today (IST calendar). If not, sends a friendly push nudge to their
// device(s).
//
// Skips Sundays (site off-days) and skips engineers with no push
// subscription (no phone opted in yet → no nudge to receive).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { istDayStart } from "@/lib/istDay";
import { ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Same fail-closed CRON_SECRET pattern as the overdue-digest endpoint.
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
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday in IST (since istDayStart returns UTC midnight of the IST day)
  if (dayOfWeek === 0) {
    return NextResponse.json({ skipped: "Sunday", sentTo: 0 });
  }

  // Every site engineer on every active project with schedule + push subs.
  // The `pushSubscriptions: { some: {} }` filter drops users with no opted-in
  // device — nothing to send to them anyway, saves a query.
  const projects = await prisma.project.findMany({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });

  const engineers = await prisma.user.findMany({
    where: {
      active: true,
      role: ROLES.SITE_ENGINEER,
      pushSubscriptions: { some: {} },
    },
    select: {
      id: true,
      name: true,
      // Progress entries logged today across ANY project. A single "you've
      // logged today" check across the org is fine for launch — an engineer
      // typically works one project.
      progressEntries: {
        where: { date: { gte: today } },
        select: { id: true },
        take: 1,
      },
    },
  });

  let sentTo = 0;
  const perUser: { userId: string; sent: number; pruned: number }[] = [];
  const perProjectUrl = (pid: string) => `/mobile/${pid}`;

  // Pick the first project we know about for the tap-through URL. In V1
  // every engineer uses Amanvana P1; when we go multi-project we'll
  // resolve the user's home project properly.
  const primaryProjectId = projects[0]?.id;
  if (!primaryProjectId) {
    return NextResponse.json({ skipped: "no active projects", sentTo: 0 });
  }

  for (const eng of engineers) {
    if (eng.progressEntries.length > 0) continue; // already logged today
    const outcome = await sendPushToUser(eng.id, {
      title: "Log today's progress",
      body: `Nothing logged yet today. Open Siddhi and add a Progress entry.`,
      url: perProjectUrl(primaryProjectId) + "/progress/new",
      tag: `progress-nudge-${today.toISOString().slice(0, 10)}`,
    });
    perUser.push({ userId: eng.id, sent: outcome.sent, pruned: outcome.pruned });
    if (outcome.sent > 0) sentTo += 1;
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    dateIST: today.toISOString().slice(0, 10),
    dayOfWeek,
    engineersChecked: engineers.length,
    sentTo,
    perUser,
  });
}
