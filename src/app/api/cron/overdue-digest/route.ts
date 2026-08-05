// ---------------------------------------------------------------------------
// Nightly overdue-baseline digest — Vercel Cron endpoint.
//
// Scans all active projects for VillaMilestones whose projectedFinish (or
// actualFinish, if in flight) has slipped past baselineFinish, and sends a
// digest email to the configured recipients per project.
//
// Scheduled in vercel.json for 03:00 IST (21:30 UTC prev day). Manual trigger
// works too: GET this route with the CRON_SECRET header from an admin box.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_RECIPIENTS,
  overdueDigestEmail,
  sendEmail,
  type OverdueDigestItem,
} from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "https://siddhi-whitelotus.vercel.app";

export async function GET(req: NextRequest) {
  // Vercel Cron passes a Bearer token that matches CRON_SECRET. Reject anything
  // else so this endpoint can't be triggered anonymously.
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asOf = new Date();
  const projects = await prisma.project.findMany({
    where: {
      // Only projects that have some VillaMilestones (i.e. schedule imported).
      villas: { some: { milestones: { some: {} } } },
    },
    select: { id: true, name: true },
  });

  const perProjectResults: Array<{ project: string; sent: boolean; count: number; skipped?: boolean; error?: string }> = [];

  for (const project of projects) {
    // Pull VillaMilestones with enough context to build the digest rows.
    const rows = await prisma.villaMilestone.findMany({
      where: {
        villa: { projectId: project.id },
        baselineFinish: { not: null, lt: asOf },
        actualFinish: null,  // still in flight
      },
      select: {
        baselineFinish: true,
        projectedFinish: true,
        actualFinish: true,
        pctComplete: true,
        section: { select: { name: true, orderIndex: true } },
        villa: {
          select: {
            number: true,
            label: true,
            block: { select: { code: true } },
          },
        },
      },
    });

    const items: OverdueDigestItem[] = rows
      .map((r): OverdueDigestItem | null => {
        const bf = r.baselineFinish!;
        const eff = r.projectedFinish ?? asOf;   // if no projected, "as-of" today
        const slipDays = Math.round((eff.getTime() - bf.getTime()) / 86_400_000);
        if (slipDays <= 0) return null;
        return {
          villaLabel: r.villa.label ?? `Villa ${r.villa.number}`,
          sectionName: r.section.name,
          baselineFinish: bf,
          slipDays,
          currentPct: Math.round(r.pctComplete),
        };
      })
      .filter((x): x is OverdueDigestItem => x !== null)
      .sort((a, b) => b.slipDays - a.slipDays);  // worst first

    const dashboardUrl = `${SIDDHI_BASE_URL}/projects/${project.id}/snapshot`;
    const draft = overdueDigestEmail({
      projectName: project.name,
      dashboardUrl,
      items,
      asOf,
    });

    if (!draft) {
      // No overdue items — quietly skip. We only email when there's something to say.
      perProjectResults.push({ project: project.name, sent: false, count: 0 });
      continue;
    }

    const result = await sendEmail({
      ...draft,
      to: DEFAULT_RECIPIENTS,  // per product-owner spec: vandana + shraddha
    });
    perProjectResults.push({
      project: project.name,
      sent: result.ok && !result.skipped,
      count: items.length,
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return NextResponse.json({
    asOf: asOf.toISOString(),
    projectsScanned: projects.length,
    results: perProjectResults,
  });
}
