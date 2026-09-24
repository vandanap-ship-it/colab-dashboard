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
import { sendPushToUser } from "@/lib/push";
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

      // Push companion — same opt-in gate as the email (they came in
      // through the receivesDailyTaskEmail set). Fires only when the
      // user has a live push subscription; sendPushToUser silently
      // returns { sent: 0 } if not. Tag is date-scoped so a same-day
      // retry replaces the earlier push instead of stacking a second
      // notification tile.
      const pushBody = buildPushBody(buckets);
      if (pushBody) {
        void sendPushToUser(user.id, {
          title: `Waiting on you · ${pStale.projectName}`,
          body: pushBody,
          url: `/mobile/${pStale.projectId}`,
          tag: `waiting-nudge-${asOf.toISOString().slice(0, 10)}-${pStale.projectId}`,
        });
      }
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

/**
 * One-line push body — mirrors the ordering the email + on-screen strip
 * use (escalation-strength first, own drafts last). Returns null when
 * every bucket is 0 so the caller can skip the push cleanly.
 *
 * Kept short: iOS shows the first ~60-80 chars in the collapsed
 * notification tile, so the leading buckets need to earn their place.
 * Truncates with "…" when three or more buckets fire so the tile stays
 * on one line at the OS's preview width.
 */
function buildPushBody(buckets: {
  staleWirs: number;
  stalePermits: number;
  staleHindrances: number;
  staleIssues: number;
  staleConcerns: number;
  myDrafts: number;
}): string | null {
  type Row = { n: number; label: string };
  const rows: Row[] = [
    { n: buckets.stalePermits, label: buckets.stalePermits === 1 ? "stale permit" : "stale permits" },
    { n: buckets.staleHindrances, label: buckets.staleHindrances === 1 ? "stale blocker" : "stale blockers" },
    { n: buckets.staleIssues, label: buckets.staleIssues === 1 ? "stale snag" : "stale snags" },
    { n: buckets.staleConcerns, label: buckets.staleConcerns === 1 ? "stale concern" : "stale concerns" },
    { n: buckets.staleWirs, label: buckets.staleWirs === 1 ? "stale WIR" : "stale WIRs" },
    { n: buckets.myDrafts, label: buckets.myDrafts === 1 ? "draft to finish" : "drafts to finish" },
  ].filter((r) => r.n > 0);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 2).map((r) => `${r.n} ${r.label}`).join(", ");
  return rows.length > 2 ? `${shown}, +${rows.length - 2} more` : shown;
}
