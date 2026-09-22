// ---------------------------------------------------------------------------
// Daily "Waiting on you" email nudge — Vercel Cron endpoint.
//
// Fires at 08:00 IST Mon-Sat (02:30 UTC, per vercel.json). Catches people
// who don't open the mobile app first thing but would still want to know
// they have overdue rows. Same SLA math the on-screen home strip uses, so
// the two channels never disagree on what counts as "stale".
//
// Recipients: every active user with `receivesDailyTaskEmail: true` and an
// email on file. That flag already opts people into the daily-tasks mail —
// this nudge sits in the same behavioural bucket, so we reuse it rather
// than add a second flag; splitting the two is a follow-up if anyone asks.
//
// One email per (user, project) pair with a non-zero total. A user with
// zero stale rows across everything they can see gets no mail.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, waitingNudgeEmail } from "@/lib/email";
import { istDayStart } from "@/lib/istDay";
import {
  canAccessModule,
  parseUserModules,
  primaryModuleFor,
  MODULES,
} from "@/lib/modules";
import {
  WIR_TIERS,
  PERMIT_TIERS,
  HINDRANCE_TIERS,
  CONCERN_TIERS,
  ISSUE_TIERS,
  RFI_TIERS,
} from "@/lib/queueAge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "https://siddhi-whitelotus.vercel.app";

interface ProjectStaleCounts {
  projectId: string;
  projectName: string;
  staleWirsAll: number;
  staleWirsQaqc: number;
  staleWirsSafety: number;
  stalePermits: number;
  staleHindrances: number;
  staleIssuesAll: number;
  staleIssuesQaqc: number;
  staleIssuesSafety: number;
  staleRfis: number;
  staleConcerns: number;
}

export async function GET(req: NextRequest) {
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

  return runNudge();
}

/**
 * Shared implementation used by both the cron GET handler and the admin
 * test-send route. Computes stale counts per project once, then walks
 * recipients and personalizes their per-project total.
 */
export async function runNudge(overrideRecipients?: Array<{ id: string; name: string; email: string; modulesField: string | null; role: string }>) {
  const asOf = istDayStart();
  const nowMs = Date.now();
  const wirCutoff = new Date(nowMs - WIR_TIERS.staleAt * 86_400_000);
  const permitCutoff = new Date(nowMs - PERMIT_TIERS.staleAt * 86_400_000);
  const hindranceCutoff = new Date(nowMs - HINDRANCE_TIERS.staleAt * 86_400_000);
  const concernCutoff = new Date(nowMs - CONCERN_TIERS.staleAt * 86_400_000);
  const issueCutoff = new Date(nowMs - ISSUE_TIERS.staleAt * 86_400_000);
  const rfiCutoff = new Date(nowMs - RFI_TIERS.staleAt * 86_400_000);

  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  // One pass per project. Compute the six per-domain counts, split QA/QC vs
  // Safety on WIRs and Issues (the two module-tagged domains) so scoped
  // users only see numbers they can act on.
  const projectStale: ProjectStaleCounts[] = [];
  for (const p of projects) {
    const base = { projectId: p.id, deletedAt: null } as const;
    const [
      staleWirsQaqc,
      staleWirsSafety,
      staleWirsGeneral,
      stalePermits,
      staleHindrances,
      staleIssuesQaqc,
      staleIssuesSafety,
      staleIssuesGeneral,
      staleRfis,
      staleConcerns,
    ] = await Promise.all([
      prisma.inspection.count({ where: { ...base, status: "IN_REVIEW", module: "QAQC", createdAt: { lt: wirCutoff } } }),
      prisma.inspection.count({ where: { ...base, status: "IN_REVIEW", module: "SAFETY", createdAt: { lt: wirCutoff } } }),
      prisma.inspection.count({ where: { ...base, status: "IN_REVIEW", module: null, createdAt: { lt: wirCutoff } } }),
      prisma.workPermit.count({ where: { ...base, status: "PENDING", createdAt: { lt: permitCutoff } } }),
      prisma.hindrance.count({ where: { ...base, status: "OPEN", startDate: { lt: hindranceCutoff } } }),
      prisma.issue.count({ where: { ...base, status: { in: ["OPEN", "IN_REINSPECTION"] }, module: "QAQC", createdAt: { lt: issueCutoff } } }),
      prisma.issue.count({ where: { ...base, status: { in: ["OPEN", "IN_REINSPECTION"] }, module: "SAFETY", createdAt: { lt: issueCutoff } } }),
      prisma.issue.count({ where: { ...base, status: { in: ["OPEN", "IN_REINSPECTION"] }, module: null, createdAt: { lt: issueCutoff } } }),
      prisma.rfi.count({ where: { ...base, status: "OPEN", createdAt: { lt: rfiCutoff } } }),
      prisma.concern.count({ where: { ...base, status: "PENDING", createdAt: { lt: concernCutoff } } }),
    ]);
    projectStale.push({
      projectId: p.id,
      projectName: p.name,
      staleWirsAll: staleWirsQaqc + staleWirsSafety + staleWirsGeneral,
      staleWirsQaqc,
      staleWirsSafety,
      stalePermits,
      staleHindrances,
      staleIssuesAll: staleIssuesQaqc + staleIssuesSafety + staleIssuesGeneral,
      staleIssuesQaqc,
      staleIssuesSafety,
      staleRfis,
      staleConcerns,
    });
  }

  const recipients =
    overrideRecipients ??
    (await prisma.user.findMany({
      where: {
        active: true,
        receivesDailyTaskEmail: true,
        email: { not: null },
      },
      select: { id: true, name: true, email: true, modules: true, role: true },
    })).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email!,
      modulesField: u.modules,
      role: u.role,
    }));

  const sent: Array<{ userId: string; projectId: string; ok: boolean; skipped?: string; error?: string }> = [];

  for (const user of recipients) {
    const mods = parseUserModules(user.modulesField);
    const isFullAccess = mods === null;
    // Filter each per-domain count against what the user can act on. A
    // SAFETY-scoped contractor sees only safety-tagged WIR + issue
    // counts; a HINDRANCE-only user sees only the hindrance count.
    const canQAQC = isFullAccess || (mods?.has("QAQC") ?? false);
    const canSAFETY = isFullAccess || (mods?.has("SAFETY") ?? false);
    const canQuality = canQAQC || canSAFETY;
    const canHINDRANCE = isFullAccess || (mods?.has("HINDRANCE") ?? false);
    const canPERMIT = isFullAccess || (mods?.has("PERMIT") ?? false);
    const canCONCERN = isFullAccess || (mods?.has("CONCERN") ?? false);
    const canRFI = isFullAccess || (mods?.has("RFI") ?? false);
    void canAccessModule; void MODULES; void primaryModuleFor; // silence-unused when hot-swapping helpers later

    // Draft count for THIS user across all projects (drafts are strictly
    // per-filler; they never leak between fillers so this is safe).
    const myDraftCount = canQuality
      ? await prisma.inspection.count({
          where: { deletedAt: null, status: "DRAFT", filledById: user.id },
        })
      : 0;

    // For scoped users the app currently ships one project (Amanvana); the
    // per-project loop keeps the design honest for a multi-project future
    // without changing behaviour today.
    for (const pStale of projectStale) {
      // Choose the WIR + Issue variant that matches the user's module scope.
      const staleWirsForUser = canQAQC && canSAFETY
        ? pStale.staleWirsAll
        : canQAQC
          ? pStale.staleWirsQaqc
          : canSAFETY
            ? pStale.staleWirsSafety
            : 0;
      const staleIssuesForUser = canQAQC && canSAFETY
        ? pStale.staleIssuesAll
        : canQAQC
          ? pStale.staleIssuesQaqc
          : canSAFETY
            ? pStale.staleIssuesSafety
            : 0;

      const buckets = {
        staleWirs: staleWirsForUser,
        stalePermits: canPERMIT ? pStale.stalePermits : 0,
        staleHindrances: canHINDRANCE ? pStale.staleHindrances : 0,
        staleIssues: staleIssuesForUser,
        staleRfis: canRFI ? pStale.staleRfis : 0,
        staleConcerns: canCONCERN ? pStale.staleConcerns : 0,
        myDrafts: myDraftCount,
      };

      const email = waitingNudgeEmail({
        to: user.email,
        toName: user.name,
        projectName: pStale.projectName,
        asOf,
        buckets,
        homeUrl: `${SIDDHI_BASE_URL}/mobile/${pStale.projectId}`,
      });
      if (!email) {
        sent.push({ userId: user.id, projectId: pStale.projectId, ok: true, skipped: "no stale rows" });
        continue;
      }
      const result = await sendEmail(email);
      sent.push({ userId: user.id, projectId: pStale.projectId, ok: result.ok, error: result.error });
    }
  }

  return NextResponse.json({
    ok: true,
    asOf: asOf.toISOString().slice(0, 10),
    projectCount: projectStale.length,
    recipientCount: recipients.length,
    sent,
  });
}
