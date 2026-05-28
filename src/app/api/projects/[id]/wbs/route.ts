import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isScopedUser } from "@/lib/modules";

export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/wbs">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // External contractors are scoped to their module and must not see the
  // project schedule. Return an empty list so their forms degrade gracefully
  // (no activity picker) rather than erroring.
  if (isScopedUser(session.user.modules)) {
    return NextResponse.json({ nodes: [] });
  }

  const { id: projectId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const leavesOnly = searchParams.get("leaves") === "true";

  const all = await prisma.wBSNode.findMany({
    where: { projectId },
    orderBy: [{ level: "asc" }, { orderIndex: "asc" }],
    include: { contractor: { select: { id: true, name: true, category: true } } },
  });

  // Determine which nodes have children (those that are NOT in any node's parentId set are leaves).
  const hasChildren = new Set<string>();
  for (const n of all) if (n.parentId) hasChildren.add(n.parentId);

  // Build breadcrumb name path for each node
  const byId = new Map(all.map((n) => [n.id, n]));
  function pathOf(node: (typeof all)[number]): string[] {
    const out: string[] = [];
    let cur: typeof node | undefined = node;
    while (cur) {
      out.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }

  const nodes = all.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    taskCode: n.taskCode,
    name: n.name,
    level: n.level,
    orderIndex: n.orderIndex,
    isLeaf: !hasChildren.has(n.id),
    path: pathOf(n),
    baselineStart: n.baselineStart,
    baselineFinish: n.baselineFinish,
    actualStart: n.actualStart,
    actualFinish: n.actualFinish,
    projectedFinish: n.projectedFinish,
    percentComplete: n.percentComplete,
    category: n.category,
    predecessorsRaw: n.predecessorsRaw,
    totalQuantity: n.totalQuantity,
    unit: n.unit,
    contractor: n.contractor,
  }));

  const filtered = leavesOnly ? nodes.filter((n) => n.isLeaf) : nodes;

  return NextResponse.json({ nodes: filtered });
}
