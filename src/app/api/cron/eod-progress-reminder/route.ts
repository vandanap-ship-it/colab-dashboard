// ---------------------------------------------------------------------------
// End-of-day progress + manpower EMAIL reminder — Vercel Cron endpoint.
//
// Vandana (2026-11-03):
//   Sampath → responsible for A&T's progress + manpower
//   Harish  → responsible for Elegant's progress + manpower
//
// Fires at 11:50 UTC = 17:20 IST, Mon–Sat. For each configured owner, we
// check whether ANY ProgressEntry or ManpowerEntry has been logged against
// their contractor(s) on today's IST calendar day — by anyone, not just by
// the owner themselves. If their contractor set has zero entries today, we
// email that owner a reminder. If someone else logged for their contractor,
// their reminder is skipped. If both have been covered, nothing goes out.
//
// Add more owners by extending OWNERSHIP. Add more contractor patterns to
// an existing owner if a contractor renames or splits (contractorPatterns
// are case-insensitive substring matches on Contractor.name).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, shell } from "@/lib/email";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

interface Owner {
  /** First-name prefix on User.name (case-insensitive). */
  userNamePrefix: string;
  /** Contractor.name must contain one of these substrings (case-insensitive). */
  contractorPatterns: string[];
}

const OWNERSHIP: Owner[] = [
  { userNamePrefix: "Sampath", contractorPatterns: ["A&T", "A & T"] },
  { userNamePrefix: "Harish",  contractorPatterns: ["Elegant", "Elegent"] },
];

export async function GET(req: NextRequest) {
  // Same fail-closed CRON_SECRET auth as the sibling crons.
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
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday
  if (dayOfWeek === 0) {
    return NextResponse.json({ skipped: "Sunday", sentTo: 0 });
  }

  // Resolve project link once (for the email CTA).
  const primaryProject = await prisma.project.findFirst({
    where: { villas: { some: { milestones: { some: {} } } } },
    select: { id: true, name: true },
  });

  const perOwner: {
    userNamePrefix: string;
    userName?: string;
    email: string | null;
    contractorsMatched: { id: string; name: string }[];
    progressCount: number;
    manpowerCount: number;
    status: "sent" | "already-logged" | "no-user" | "no-contractors" | "no-email" | "send-failed";
    reason?: string;
  }[] = [];

  for (const owner of OWNERSHIP) {
    // Resolve the owner user (by name prefix) and their contractor set
    // (by substring on contractor name) in parallel.
    const [user, contractors] = await Promise.all([
      prisma.user.findFirst({
        where: {
          active: true,
          name: { startsWith: owner.userNamePrefix, mode: "insensitive" },
        },
        select: { id: true, name: true, email: true },
      }),
      prisma.contractor.findMany({
        where: {
          projectId: primaryProject?.id,
          OR: owner.contractorPatterns.map((p) => ({
            name: { contains: p, mode: "insensitive" as const },
          })),
        },
        select: { id: true, name: true },
      }),
    ]);

    if (!user) {
      perOwner.push({
        userNamePrefix: owner.userNamePrefix,
        email: null,
        contractorsMatched: [],
        progressCount: 0,
        manpowerCount: 0,
        status: "no-user",
        reason: `no active user matched "${owner.userNamePrefix}"`,
      });
      continue;
    }

    if (contractors.length === 0) {
      perOwner.push({
        userNamePrefix: owner.userNamePrefix,
        userName: user.name,
        email: user.email,
        contractorsMatched: [],
        progressCount: 0,
        manpowerCount: 0,
        status: "no-contractors",
        reason: `no contractor matched patterns ${JSON.stringify(owner.contractorPatterns)}`,
      });
      continue;
    }

    const contractorIds = contractors.map((c) => c.id);

    // Did ANYONE log for this owner's contractors today?
    const [progressCount, manpowerCount] = await Promise.all([
      prisma.progressEntry.count({
        where: {
          contractorId: { in: contractorIds },
          date: { gte: today },
          deletedAt: null,
        },
      }),
      prisma.manpowerEntry.count({
        where: {
          contractorId: { in: contractorIds },
          entryDate: { gte: today },
          deletedAt: null,
        },
      }),
    ]);

    const covered = progressCount + manpowerCount > 0;
    if (covered) {
      perOwner.push({
        userNamePrefix: owner.userNamePrefix,
        userName: user.name,
        email: user.email,
        contractorsMatched: contractors,
        progressCount,
        manpowerCount,
        status: "already-logged",
      });
      continue;
    }

    if (!user.email) {
      perOwner.push({
        userNamePrefix: owner.userNamePrefix,
        userName: user.name,
        email: null,
        contractorsMatched: contractors,
        progressCount,
        manpowerCount,
        status: "no-email",
        reason: "user has no email on file",
      });
      continue;
    }

    // Nothing logged for their contractors — send the reminder.
    const dateIst = today.toISOString().slice(0, 10);
    const link = primaryProject
      ? `${SIDDHI_BASE_URL}/mobile/${primaryProject.id}/progress/new`
      : SIDDHI_BASE_URL;
    const contractorList = contractors.map((c) => c.name).join(", ");
    const html = shell({
      preheader: `Nothing logged yet today for ${contractorList} — a quick reminder before you head home.`,
      headline: `Hi ${user.name.split(" ")[0]}, log today's update for ${contractorList}`,
      bodyHtml: `
        <p style="margin: 0 0 12px;">A quick end-of-day reminder — nothing has
        been logged in Siddhi for <strong>${contractorList}</strong> on
        <strong>${dateIst}</strong> yet.</p>
        <p style="margin: 0 0 12px;">Before you leave site, please add today's
        progress and manpower${primaryProject ? ` on ${primaryProject.name}` : ""}.
        It takes a minute and keeps tomorrow's planning honest.</p>
        <p style="margin: 0;">If someone else has already logged on your
        behalf since this email went out, you can safely ignore it.</p>
      `,
      cta: { text: "Open Log Progress", url: link },
    });

    const result = await sendEmail({
      to: user.email,
      subject: `Siddhi · log today's progress for ${contractorList} (${dateIst})`,
      html,
    });
    perOwner.push({
      userNamePrefix: owner.userNamePrefix,
      userName: user.name,
      email: user.email,
      contractorsMatched: contractors,
      progressCount,
      manpowerCount,
      status: result.ok ? "sent" : "send-failed",
      reason: result.error,
    });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    dateIST: today.toISOString().slice(0, 10),
    dayOfWeek,
    sentTo: perOwner.filter((p) => p.status === "sent").length,
    perOwner,
  });
}
