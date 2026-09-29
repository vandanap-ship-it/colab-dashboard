import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PROGRESS_GATES } from "@/lib/progressGates";

/**
 * Colab-parity "In Quality" bucket for the Site Progress list. Returns
 * `{ blockedVillaIds: string[] }` — every villa on this project that has
 * at least one WBS activity currently blocked by a pending QAQC
 * checklist (i.e. a `checkPrecheck` refusal in aggregate form).
 *
 * The gate rules live in [progressGates.ts](src/lib/progressGates.ts).
 * Colab's full gate table lives server-side at /cm/checklistConfig and
 * isn't in any CSV export — see the memory file
 * `colab_qaqc_gate_investigation.md` for the extraction plan. Until
 * that's done, this endpoint reflects Siddhi's current 5-pair regex
 * list; adding a gate there automatically updates this count.
 *
 * Implementation avoids per-villa round-trips: two Prisma queries, then
 * an O(activities × gates) walk in-memory.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Pull every activity tagged to a villa on this project. `villaId`
  // scopes the gate check — Villa 3 rebar can't gate Villa 12
  // concreting even though the regexes match, per checkPrecheck.
  const activities = await prisma.wBSNode.findMany({
    where: { projectId, villaId: { not: null } },
    select: { id: true, name: true, villaId: true },
  });
  if (activities.length === 0) {
    return NextResponse.json({ blockedVillaIds: [] });
  }

  // All PASSED inspections on the project, grouped by wbsNodeId.
  const passedRows = await prisma.inspection.findMany({
    where: { projectId, status: "PASSED", deletedAt: null },
    select: { wbsNodeId: true },
  });
  const passedByNode = new Set(passedRows.map((r) => r.wbsNodeId));

  // Group activities per villa so a gate check walks one villa's list.
  const byVilla = new Map<string, Array<{ id: string; name: string }>>();
  for (const a of activities) {
    if (!a.villaId) continue;
    const arr = byVilla.get(a.villaId) ?? [];
    arr.push({ id: a.id, name: a.name });
    byVilla.set(a.villaId, arr);
  }

  const blocked = new Set<string>();
  for (const [villaId, villaActs] of byVilla) {
    for (const act of villaActs) {
      // Which gates fire on this activity?
      const applicable = PROGRESS_GATES.filter((g) => g.activityMatch.test(act.name));
      if (applicable.length === 0) continue;

      // For each applicable gate, is there a prerequisite activity on
      // the same villa AND does any of its rows have a PASSED
      // inspection?
      for (const gate of applicable) {
        const prereqs = villaActs.filter((n) => gate.prerequisiteMatch.test(n.name));
        if (prereqs.length === 0) {
          // No prerequisite on this villa — gate doesn't apply here
          // (matches checkPrecheck semantics).
          continue;
        }
        const anyPassed = prereqs.some((p) => passedByNode.has(p.id));
        if (!anyPassed) {
          blocked.add(villaId);
          break; // one blocked activity is enough to flag the villa
        }
      }
      if (blocked.has(villaId)) break;
    }
  }

  return NextResponse.json({ blockedVillaIds: Array.from(blocked) });
}
