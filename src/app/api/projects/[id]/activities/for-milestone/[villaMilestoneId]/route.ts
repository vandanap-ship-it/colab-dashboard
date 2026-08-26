import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Leaf activities under a specific VillaMilestone — the terminal drilldown
 * step of the mobile activity picker.
 *
 * Returns star-first (isSubMilestone=true) so the site engineer sees the
 * gate task at the top; typical result is 5-15 nodes.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; villaMilestoneId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId, villaMilestoneId } = await params;

  const nodes = await prisma.wBSNode.findMany({
    where: {
      projectId,
      villaMilestoneId,
    },
    orderBy: [
      { isSubMilestone: "desc" },
      { orderIndex: "asc" },
    ],
    select: {
      id: true,
      name: true,
      taskCode: true,
      percentComplete: true,
      isSubMilestone: true,
      actualStart: true,
      actualFinish: true,
      baselineStart: true,
      baselineFinish: true,
      totalQuantity: true,
      unit: true,
      contractor: { select: { id: true, name: true } },
    },
  });

  const activities = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    taskCode: n.taskCode,
    percentComplete: Math.round(n.percentComplete ?? 0),
    isStar: n.isSubMilestone,
    started: !!n.actualStart,
    done: !!n.actualFinish,
    totalQuantity: n.totalQuantity,
    unit: n.unit,
    contractor: n.contractor,
  }));

  return NextResponse.json({ activities });
}
