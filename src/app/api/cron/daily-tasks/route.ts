// ---------------------------------------------------------------------------
// Daily "today's site tasks" email — Vercel Cron endpoint.
//
// Fires at 07:00 IST Mon-Sat (01:30 UTC Mon-Sat, per vercel.json). Pulls every
// WBS leaf whose baseline window straddles today (baselineStart <= today <=
// baselineFinish) and isn't already 100% complete, groups by block + villa,
// and mails the list to Harish + Madhavarajan so the site team walks in
// knowing what's on today's list.
//
// Recipient set is now User.receivesDailyTaskEmail — toggled from
// Admin > Users. Follow-up on Phase B: replaces the earlier hardcoded
// ["harish.bs", "madhavarajan.s"] username allowlist so the team can grow
// without editing shipped code.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  // Same fail-closed auth as the other two cron endpoints.
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
  const dayOfWeek = today.getUTCDay();
  if (dayOfWeek === 0) {
    return NextResponse.json({ skipped: "Sunday", asOf: today.toISOString() });
  }

  // Recipient set is every active User with receivesDailyTaskEmail=true.
  // Admin > Users owns the setting; no code change needed to add or drop
  // recipients.
  const recipients = await prisma.user.findMany({
    where: {
      active: true,
      receivesDailyTaskEmail: true,
      email: { not: null },
    },
    select: { email: true, name: true, username: true },
  });
  const emails = recipients
    .map((r) => r.email)
    .filter((e): e is string => !!e);
  if (emails.length === 0) {
    return NextResponse.json({
      skipped: "no active recipients with an email address on file",
      asOf: today.toISOString(),
    });
  }

  const projects = await prisma.project.findMany({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });

  const perProjectResults: Array<{
    project: string;
    items: number;
    sent: boolean;
    skipped?: boolean;
    error?: string;
  }> = [];

  for (const project of projects) {
    // Leaves = nodes tied to a villaMilestone (schedule assigns activities
    // to specific villa+section pairs). Non-leaf rollup rows never carry
    // villaMilestoneId, so this filter safely excludes them without walking
    // the tree. Villa info is joined via villaMilestone.villa.block.
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

    const dashboardUrl = `${SIDDHI_BASE_URL}/projects/${project.id}/overview`;
    const draft = dailyTasksEmail({
      to: emails,
      projectName: project.name,
      dashboardUrl,
      items,
      asOf: today,
    });

    if (!draft) {
      // Nothing planned today — quiet skip so nobody gets a blank email
      // on holidays or between phases.
      perProjectResults.push({ project: project.name, items: 0, sent: false });
      continue;
    }

    const result = await sendEmail(draft);
    perProjectResults.push({
      project: project.name,
      items: items.length,
      sent: result.ok && !result.skipped,
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return NextResponse.json({
    asOf: today.toISOString(),
    dayOfWeek,
    recipients: recipients.map((r) => r.username),
    projectsScanned: projects.length,
    results: perProjectResults,
  });
}
