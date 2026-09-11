// User's browser calls this after the user grants Notification permission
// and the service worker returns a PushSubscription. We upsert by endpoint
// so a re-subscribe from the same device just refreshes the row rather
// than creating a duplicate.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";

const Body = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    update: {
      // If a browser sends the same endpoint under a different user (rare
      // but possible on a shared phone), we let the newer signed-in user
      // own the subscription.
      userId: session.user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      lastUsedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
