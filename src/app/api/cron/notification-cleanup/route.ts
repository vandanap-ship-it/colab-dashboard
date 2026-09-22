// ---------------------------------------------------------------------------
// Notification inbox cleanup — Vercel Cron endpoint.
//
// Fires once a day at 03:00 IST (21:30 UTC, per vercel.json). Deletes rows
// from Notification where the user has read them AND the read event was
// more than 30 days ago.
//
// Deliberately narrow:
//   * Unread rows STAY forever. Something the user hasn't seen shouldn't
//     silently disappear — the whole point of the inbox is to catch pings
//     the user missed on the browser side.
//   * The cutoff runs off readAt, not createdAt — a notification the user
//     ignored for 45 days but read yesterday shouldn't vanish tonight.
//   * No per-user cap. If a heavy user has 400 read rows within 30 days
//     they keep them all; the daily prune tomorrow will trim yesterday's
//     stragglers. Simpler than a rolling window; the inbox page fetches
//     at most 100 anyway.
//
// Manual test: with `next dev`, `curl -H "Authorization: Bearer $CRON_SECRET"
// http://localhost:3000/api/cron/notification-cleanup` returns
// { deleted: N }.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CLEANUP_WINDOW_DAYS = 30;

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

  return runCleanup();
}

/**
 * Extracted so an admin one-off can also invoke it without spoofing a
 * cron auth header. Returns the count deleted so the cron logs carry
 * a signal that the job actually did something.
 */
export async function runCleanup(): Promise<Response> {
  const cutoff = new Date(Date.now() - CLEANUP_WINDOW_DAYS * 86_400_000);
  const result = await prisma.notification.deleteMany({
    where: {
      // NOT null → read; date compare → strictly older than the cutoff.
      readAt: { not: null, lt: cutoff },
    },
  });
  return NextResponse.json({ deleted: result.count, cutoff: cutoff.toISOString() });
}
