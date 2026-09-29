import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/contractors
 *
 * Returns the active contractors on this project — powers the
 * Colab-parity Contractor picker on the mobile WIR form (bottom
 * sheet with search). Sorted alphabetically for stable UI.
 *
 * Auth: signed-in user with access to the project. No module gate —
 * every module (Progress, QAQC, EHS, Permits) needs the contractor
 * list at some point, so the endpoint is broadly available; the
 * sensitive stuff (write, admin) lives elsewhere.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const contractors = await prisma.contractor.findMany({
    where: { projectId, active: true },
    select: { id: true, name: true, category: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ contractors });
}
