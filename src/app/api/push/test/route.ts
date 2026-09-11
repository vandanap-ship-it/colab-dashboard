// Fires a test push to the current user's own subscriptions. Anyone signed
// in can trigger it — it only touches their own devices. Kept small so
// the Profile page's "Send me a test" button is a single fetch.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";
import { unauthorized } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const outcome = await sendPushToUser(session.user.id, {
    title: "Siddhi notifications are on",
    body: "You'll get updates like this for permit decisions, assigned tasks, and daily prompts.",
    url: "/mobile",
    tag: "test-notification",
  });

  return NextResponse.json({
    ok: true,
    sent: outcome.sent,
    pruned: outcome.pruned,
    hint:
      outcome.sent === 0
        ? "No push subscription found for this account. Tap 'Turn on notifications' on the mobile home first."
        : `Sent to ${outcome.sent} device${outcome.sent === 1 ? "" : "s"}.`,
  });
}
