// ---------------------------------------------------------------------------
// Safety Induction expiry cron — Vercel Cron endpoint.
//
// Fires once a day at 06:00 IST (00:30 UTC, per vercel.json). Two jobs:
//
//   1. Flip APPROVED rows past their expiryDate to EXPIRED. The site team
//      shouldn't have to manually re-check every worker's validity before
//      letting them on site — the EXPIRED chip on the list card makes it
//      obvious at a glance.
//
//   2. Push the maker 30 days before expiry so they can plan the
//      re-induction visit. One push per worker, tagged
//      `induction-expiry-warn-{inductionId}` so re-running the cron the
//      next day doesn't stack a second notification.
//
// Both passes are idempotent — the update is scoped to {status: APPROVED,
// expiryDate < now} so a row already flipped yesterday is skipped; the
// warning push's tag deduplicates with the previous day's send.
//
// Manual test: with `next dev` and CRON_SECRET set, call
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/induction-expiry
// → { expired: N, warned: M }.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

const WARN_WINDOW_DAYS = 30;

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

  const now = new Date();
  const warnCutoff = new Date(now.getTime() + WARN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Pass 1 — flip past-expiry rows. updateMany + inside-filter means
  // nothing fires on a row that was already EXPIRED or whose expiryDate
  // is still in the future, so the pass is safe to re-run.
  const flipped = await prisma.safetyInduction.updateMany({
    where: {
      status: "APPROVED",
      expiryDate: { lt: now },
      deletedAt: null,
    },
    data: { status: "EXPIRED" },
  });

  // Fetch the rows we just flipped (same filter minus the status flip)
  // so we can push each maker. Prisma's updateMany doesn't return the
  // affected ids; re-querying by status=EXPIRED AND expiryDate < now
  // AND the push wasn't sent gives us the right set.
  // We skip push for anything that already got the "has expired" push —
  // tag dedup handles that automatically on the receiver side.
  const expired = await prisma.safetyInduction.findMany({
    where: {
      status: "EXPIRED",
      expiryDate: { lt: now },
      deletedAt: null,
      updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // last 24h
    },
    select: {
      id: true,
      projectId: true,
      displayId: true,
      workerName: true,
      createdById: true,
    },
  });
  await Promise.allSettled(
    expired.map((e) =>
      sendPushToUser(e.createdById, {
        title: `Induction expired · ${e.workerName}`,
        body: `${e.displayId} is past its 12-month validity. Raise a fresh induction before the worker returns on site.`,
        url: `/mobile/${e.projectId}/induction/${e.id}`,
        tag: `induction-expired-${e.id}`,
      }),
    ),
  );

  // Pass 2 — 30-day warning. APPROVED rows whose expiryDate falls inside
  // the warn window get a one-shot push. Tag dedup means re-running the
  // cron day after day doesn't stack a new push every morning.
  const expiringSoon = await prisma.safetyInduction.findMany({
    where: {
      status: "APPROVED",
      expiryDate: { gte: now, lte: warnCutoff },
      deletedAt: null,
    },
    select: {
      id: true,
      projectId: true,
      displayId: true,
      workerName: true,
      expiryDate: true,
      createdById: true,
    },
  });
  await Promise.allSettled(
    expiringSoon.map((e) => {
      const daysLeft = Math.max(
        1,
        Math.floor((e.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );
      return sendPushToUser(e.createdById, {
        title: `Induction expires in ${daysLeft} days · ${e.workerName}`,
        body: `${e.displayId} is approaching its 12-month renewal. Plan a re-induction visit this week.`,
        url: `/mobile/${e.projectId}/induction/${e.id}`,
        tag: `induction-expiry-warn-${e.id}`,
      });
    }),
  );

  return NextResponse.json({
    expired: flipped.count,
    expiredPushes: expired.length,
    warned: expiringSoon.length,
  });
}
