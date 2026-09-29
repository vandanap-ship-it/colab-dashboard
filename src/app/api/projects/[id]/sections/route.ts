import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/sections
 *
 * Returns the project's MilestoneSection list — powers the Sub Location
 * step of the Colab-parity location cascade on the mobile WIR form.
 * Sorted by orderIndex so the site team sees "Foundation / Substructure"
 * before "Superstructure" etc.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const sections = await prisma.milestoneSection.findMany({
    where: { projectId },
    select: { id: true, code: true, name: true, orderIndex: true },
    orderBy: { orderIndex: "asc" },
  });

  return NextResponse.json({ sections });
}
