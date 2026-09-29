import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/villas
 *
 * Returns in-scope villas on this project — powers the Colab-parity
 * Villa dropdown on the WIR template picker's Activity tab and the
 * upcoming location cascade. Sorted by villa number so the site team
 * sees Villa 01, 02, 03… in order (not the raw semi-random project
 * insertion order Colab actually shows).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const villas = await prisma.villa.findMany({
    where: { projectId, inScope: true },
    select: { id: true, number: true, label: true },
    orderBy: { number: "asc" },
  });

  return NextResponse.json({ villas });
}
