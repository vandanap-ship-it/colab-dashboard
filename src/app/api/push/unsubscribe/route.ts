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
  await prisma.pushSubscription
    .delete({ where: { endpoint: parsed.data.endpoint } })
    .catch(() => {}); // idempotent — deleting a non-existent row is fine
  return NextResponse.json({ ok: true });
}
