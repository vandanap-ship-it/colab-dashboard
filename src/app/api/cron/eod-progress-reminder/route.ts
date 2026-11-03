// ---------------------------------------------------------------------------
// End-of-day progress + manpower EMAIL reminder — Vercel Cron endpoint.
//
// Vandana (2026-11-03): "can we send a reminder mail to harish and sampart if
// the progress or man power is updated for that dat at 5.20 pm". Fires at
// 11:50 UTC = 17:20 IST, Monday-Saturday. Per-user check: a target user who
// has created at least one ProgressEntry or ManpowerEntry on today's IST
// calendar day does NOT get the email; the one who hasn't does.
//
// Different from /api/cron/progress-nudge (which is a team-level 11:30 IST
// push notification). This cron is a personal email at end-of-day for the
// two site leads who own daily logging. Add more names to TARGET_NAMES to
// extend.
//
// Idempotent-ish: cron fires once per day. If a run double-fires (Vercel
// retry), the second run would also match the "no log yet" condition and
// send a second email. Resend doesn't dedupe, and we don't track sent-today
// on-disk; the cost of a duplicate reminder email is low enough to accept.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, shell } from "@/lib/email";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

/** First-name prefix match, case-insensitive. Harish BS, Sampath <whatever>. */
const TARGET_NAMES = ["Harish", "Sampath"];

export async function GET(req: NextRequest) {
  // Same fail-closed CRON_SECRET auth as the other cron endpoints.
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
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday (per istDayStart's UTC-midnight-of-IST-day convention)
  if (dayOfWeek === 0) {
    return NextResponse.json({ skipped: "Sunday", sentTo: 0 });
  }

  // Resolve the two target users. We match by name prefix so a rename
  // like "Harish BS" → "Harish B.S." doesn't silently stop the reminder.
  const candidates = await prisma.user.findMany({
    where: {
      active: true,
      OR: TARGET_NAMES.map((n) => ({ name: { startsWith: n, mode: "insensitive" as const } })),
    },
    select: { id: true, name: true, email: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({
      skipped: "no users matched",
      targets: TARGET_NAMES,
      sentTo: 0,
    });
  }

  // Project link for the CTA — same resolution the other crons use.
  const primaryProject = await prisma.project.findFirst({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });

  const perUser: {
    userId: string;
    name: string;
    email: string | null;
    status: "sent" | "already-logged" | "no-email" | "send-failed";
    reason?: string;
  }[] = [];

  for (const u of candidates) {
    // Per-user guard — if THIS user logged any progress or manpower today,
    // skip. Team-wide check would mis-fire for the person who's already
    // doing their job.
    const [progressLogged, manpowerLogged] = await Promise.all([
      prisma.progressEntry.findFirst({
        where: { createdById: u.id, date: { gte: today } },
        select: { id: true },
      }),
      prisma.manpowerEntry.findFirst({
        where: { createdById: u.id, entryDate: { gte: today } },
        select: { id: true },
      }),
    ]);
    if (progressLogged || manpowerLogged) {
      perUser.push({
        userId: u.id,
        name: u.name,
        email: u.email,
        status: "already-logged",
      });
      continue;
    }

    if (!u.email) {
      perUser.push({
        userId: u.id,
        name: u.name,
        email: null,
        status: "no-email",
        reason: "user has no email on file",
      });
      continue;
    }

    const dateIst = today.toISOString().slice(0, 10);
    const link = primaryProject
      ? `${SIDDHI_BASE_URL}/mobile/${primaryProject.id}/progress/new`
      : SIDDHI_BASE_URL;
    const html = shell({
      preheader: "Nothing logged yet today — a quick reminder before you head home.",
      headline: `Hi ${u.name.split(" ")[0]}, log today's site update`,
      bodyHtml: `
        <p style="margin: 0 0 12px;">A quick reminder — nothing has been logged
        in Siddhi for <strong>${dateIst}</strong> under your account yet.</p>
        <p style="margin: 0 0 12px;">Before you leave site, please add today's
        progress and manpower${primaryProject ? ` on ${primaryProject.name}` : ""}.
        It takes a minute and keeps tomorrow's planning honest.</p>
        <p style="margin: 0;">If someone else already logged on your behalf,
        you can safely ignore this.</p>
      `,
      cta: { text: "Open Log Progress", url: link },
    });

    const result = await sendEmail({
      to: u.email,
      subject: `Siddhi · log today's progress for ${dateIst}`,
      html,
    });
    perUser.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      status: result.ok ? "sent" : "send-failed",
      reason: result.error,
    });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    dateIST: today.toISOString().slice(0, 10),
    dayOfWeek,
    targets: TARGET_NAMES,
    candidatesChecked: candidates.length,
    sentTo: perUser.filter((p) => p.status === "sent").length,
    perUser,
  });
}
