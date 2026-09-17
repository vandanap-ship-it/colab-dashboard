// ---------------------------------------------------------------------------
// Daily progress + manpower nudge — Vercel Cron endpoint.
//
// Fires at 11:30 IST Monday to Saturday (06:00 UTC Mon-Sat, per
// vercel.json). Recipient set is every active User with
// receivesDailyNudge=true — Admin > Users owns the toggle. The nudge
// treats the group as a team: if ANY recipient has logged a ProgressEntry
// or ManpowerEntry today (IST calendar), NONE get pushed. If none has
// logged, everyone gets a friendly push nudge on any subscribed device.
//
// Skips Sundays (site off-days).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { istDayStart } from "@/lib/istDay";

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
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday in IST (istDayStart returns UTC midnight of the IST day)
  if (dayOfWeek === 0) {
    return NextResponse.json({ skipped: "Sunday", sentTo: 0 });
  }

  // Only projects that actually have a schedule loaded — landing them on a
  // shell project would just be noise.
  const projects = await prisma.project.findMany({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });
  const primaryProjectId = projects[0]?.id;
  if (!primaryProjectId) {
    return NextResponse.json({ skipped: "no active projects", sentTo: 0 });
  }

  const loggers = await prisma.user.findMany({
    where: {
      active: true,
      receivesDailyNudge: true,
    },
    select: { id: true, name: true, username: true },
  });
  if (loggers.length === 0) {
    return NextResponse.json({ skipped: "no matching loggers", sentTo: 0 });
  }

  // Team-level dedup — one entry from either logger, either kind, is enough
  // for the day. Cheapest way is two `findFirst`s that stop at the first row.
  const loggerIds = loggers.map((u) => u.id);
  const [progressLogged, manpowerLogged] = await Promise.all([
    prisma.progressEntry.findFirst({
      where: { createdById: { in: loggerIds }, date: { gte: today } },
      select: { id: true },
    }),
    prisma.manpowerEntry.findFirst({
      where: { createdById: { in: loggerIds }, entryDate: { gte: today } },
      select: { id: true },
    }),
  ]);
  if (progressLogged || manpowerLogged) {
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      dateIST: today.toISOString().slice(0, 10),
      skipped: progressLogged ? "progress already logged today" : "manpower already logged today",
      sentTo: 0,
    });
  }

  let sentTo = 0;
  const perUser: { userId: string; name: string; sent: number; pruned: number }[] = [];
  for (const u of loggers) {
    const outcome = await sendPushToUser(u.id, {
      title: "Log today's site update",
      body: "Nothing logged yet today. Open Siddhi and add progress + manpower.",
      url: `/mobile/${primaryProjectId}/progress/new`,
      tag: `progress-nudge-${today.toISOString().slice(0, 10)}`,
    });
    perUser.push({ userId: u.id, name: u.name, sent: outcome.sent, pruned: outcome.pruned });
    if (outcome.sent > 0) sentTo += 1;
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    dateIST: today.toISOString().slice(0, 10),
    dayOfWeek,
    loggersChecked: loggers.length,
    sentTo,
    perUser,
  });
}
