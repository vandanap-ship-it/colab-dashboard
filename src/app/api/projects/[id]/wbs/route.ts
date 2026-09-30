import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, hasFullAccess, MODULES } from "@/lib/modules";

// Modules whose day-to-day work is activity-linked. A user scoped to any of
// these needs the wbs to raise a WIR, log progress, or attach a permit /
// hindrance to a specific activity. Only pure CONCERN-scoped users are
// excluded — concerns are free-text notes for leadership, not activity work.
const ACTIVITY_LINKED_MODULES = [
  MODULES.PROGRESS,
  MODULES.QAQC,
  MODULES.SAFETY,
  MODULES.PERMIT,
  MODULES.HINDRANCE,
] as const;

export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/wbs">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Full-access users always get the schedule. Scoped users get it if any
  // of their modules is activity-linked (QAQC, Safety, Progress, Permit,
  // Hindrance) — otherwise their forms show an empty picker and they cannot
  // raise anything. Nagarjuna (SITE_ENGINEER, ["QAQC"]) hit this on
  // 2026-09-30: the WIR raise page said "No sections with activities on
  // this villa" because the earlier blanket `isScopedUser` early-return
  // hid all 175 leaf activities from him.
  const mods = session.user.modules;
  if (!hasFullAccess(mods)) {
    const anyActivityLinked = ACTIVITY_LINKED_MODULES.some((m) => canAccessModule(mods, m));
    if (!anyActivityLinked) {
      return NextResponse.json({ nodes: [] });
    }
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
    // Colab-parity — the mobile WIR / progress location cascade groups
    // leaves by villa + section, so surface those ids alongside each node.
    // Null on structural / phase nodes; set on leaf activities and their
    // direct parents where the importer tagged them.
    villaId: n.villaId,
    sectionId: n.sectionId,
  }));

  const filtered = leavesOnly ? nodes.filter((n) => n.isLeaf) : nodes;

  return NextResponse.json({ nodes: filtered });
}
