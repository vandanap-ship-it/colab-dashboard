// Browser calls this when the user disables notifications (from the
// service worker's pushsubscriptionchange event, or when we detect the
// subscription is gone).

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";

const Body = z.object({ endpoint: z.string().url() });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.response;
  // Ownership check: only delete a row that belongs to THIS user.
  // Prior code deleted by endpoint alone, so any signed-in user who
  // learned another user's endpoint could silence their push
  // notifications. deleteMany with a compound where is a no-op on
  // rows the caller doesn't own, preserving the idempotent shape.
  await prisma.pushSubscription
    .deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: session.user.id },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
