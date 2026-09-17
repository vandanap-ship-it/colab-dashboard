// ---------------------------------------------------------------------------
// Admin-triggered PREVIEW send of the daily "today's tasks" email.
//
// Runs the same query the 07:00 IST cron runs, but sends the mail ONLY to
// the caller's own email (from the auth session). Use it to eyeball the
// layout without waiting for the cron to fire, without adding yourself to
// the production recipient list, and without needing CRON_SECRET.
//
// Session-auth-only + admin-only. GET so it's dead simple to trigger from
// the browser bar: hit /api/admin/send-test-daily-tasks?projectId=<id>
// while signed in as an admin and the mail lands in your inbox.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import {
  dailyTasksEmail,
  sendEmail,
  type DailyTaskItem,
} from "@/lib/email";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "https://siddhi-whitelotus.vercel.app";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!session.user.email) {
    return NextResponse.json(
      { error: "Your account has no email on file — set one in Admin > Users first." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const projectIdParam = url.searchParams.get("projectId");

  // Either a specific project via ?projectId=, or the first project that
  // has a schedule loaded — matches what the cron would pick if you had
  // one project.
  const projects = projectIdParam
    ? await prisma.project.findMany({
        where: { id: projectIdParam },
        select: { id: true, name: true },
      })
    : await prisma.project.findMany({
        where: { villas: { some: { milestones: { some: {} } } } },
        select: { id: true, name: true },
      });

  if (projects.length === 0) {
    return NextResponse.json(
      { error: "No projects found (either the id is wrong, or no project has a schedule imported)." },
      { status: 404 },
    );
  }

  const today = istDayStart();
  const results: Array<{
    project: string;
    items: number;
    sent: boolean;
    skipped?: boolean;
    error?: string;
  }> = [];

  for (const project of projects) {
    const rows = await prisma.wBSNode.findMany({
      where: {
        projectId: project.id,
        villaMilestoneId: { not: null },
        baselineStart: { lte: today },
        baselineFinish: { gte: today },
        percentComplete: { lt: 100 },
      },
      select: {
        name: true,
        baselineFinish: true,
        percentComplete: true,
        contractor: { select: { name: true } },
        villaMilestone: {
          select: {
            villa: {
              select: {
                number: true,
                label: true,
                block: { select: { code: true } },
              },
            },
          },
        },
      },
    });

    const items: DailyTaskItem[] = rows
      .filter((r) => !!r.villaMilestone?.villa)
      .map((r) => {
        const v = r.villaMilestone!.villa;
        return {
          villaLabel: v.label ?? `Villa ${v.number}`,
          blockCode: v.block?.code ?? null,
          activityName: r.name,
          contractorName: r.contractor?.name ?? null,
          baselineFinish: r.baselineFinish,
          percentComplete: r.percentComplete,
        };
      })
      .sort((a, b) => {
        const bl = (a.blockCode ?? "").localeCompare(b.blockCode ?? "");
        if (bl !== 0) return bl;
        const vl = a.villaLabel.localeCompare(b.villaLabel, undefined, { numeric: true });
        if (vl !== 0) return vl;
        return a.activityName.localeCompare(b.activityName);
      });

    const draft = dailyTasksEmail({
      to: [session.user.email],
      projectName: `${project.name} (PREVIEW)`,
      dashboardUrl: `${SIDDHI_BASE_URL}/projects/${project.id}/overview`,
      items,
      asOf: today,
    });

    if (!draft) {
      results.push({ project: project.name, items: 0, sent: false });
      continue;
    }

    // Prefix the subject with [PREVIEW] so it's obvious in the inbox this
    // wasn't the scheduled morning send.
    const result = await sendEmail({
      ...draft,
      subject: `[PREVIEW] ${draft.subject}`,
    });
    results.push({
      project: project.name,
      items: items.length,
      sent: result.ok && !result.skipped,
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return NextResponse.json({
    sentTo: session.user.email,
    asOf: today.toISOString(),
    results,
  });
}
