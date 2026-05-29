import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/wbs/[nodeId]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Schedule/activity detail is PROGRESS-scoped — external contractors (QAQC /
  // Safety) must not read it, matching the /wbs list endpoint's lockout.
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId, nodeId } = await ctx.params;

  const node = await prisma.wBSNode.findFirst({
    where: { id: nodeId, projectId },
    include: { contractor: { select: { id: true, name: true, category: true } } },
  });
  if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build path
  const all = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(all.map((n) => [n.id, n]));
  const path: string[] = [];
  let cur: { id: string; name: string; parentId: string | null } | undefined = byId.get(node.id);
  while (cur) {
    path.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Recent progress entries
  const recent = await prisma.progressEntry.findMany({
    where: { wbsNodeId: nodeId },
    orderBy: { date: "desc" },
    take: 10,
    include: {
      createdBy: { select: { id: true, name: true } },
      contractor: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
      labour: { select: { id: true, category: true, count: true } },
    },
  });

  return NextResponse.json({ node: { ...node, path }, recentEntries: recent });
}
