// ---------------------------------------------------------------------------
// Admin-triggered PREVIEW send of the daily "waiting on you" nudge.
//
// Runs the same computation the 08:00 IST cron runs, but sends the mail
// ONLY to the caller's own email (from the auth session). Lets an admin
// eyeball the layout without waiting for the morning, without touching
// the production recipient list, and without needing CRON_SECRET.
//
// Session-auth + admin only. GET so it's dead simple from the browser bar:
//   /api/admin/send-test-waiting-nudge
// while signed in as admin, and the mail lands in your inbox.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { runNudge } from "@/app/api/cron/waiting-nudge/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!session.user.email) {
    return NextResponse.json({ error: "Your account has no email on file — set one first." }, { status: 400 });
  }

  // One-recipient override so the cron pipeline runs end-to-end but only
  // the admin's inbox receives the mail. Uses their real modules so the
  // stale counts reflect what they'd actually see on their own home
  // strip.
  return runNudge([
    {
      id: session.user.id,
      name: session.user.name ?? session.user.username ?? "there",
      email: session.user.email,
      modulesField: session.user.modules,
      role: session.user.role,
    },
  ]);
}
