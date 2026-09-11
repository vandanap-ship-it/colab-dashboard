// Serves the VAPID public key to the browser so the service worker can
// call pushManager.subscribe(). Safe to expose — VAPID public keys are
// intentionally shareable; only the private half needs to stay secret.
//
// A tiny dedicated endpoint (rather than inlining VAPID_PUBLIC_KEY
// into the client bundle) keeps the mobile bundle unchanged for viewers
// who never opt in, and centralises the "not configured yet" fallback.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Push notifications not configured on this deployment." },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey: key });
}
