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
 * location cascade on InspectionForm / ReportForm. Sorted by villa
 * number so the site team sees Villa 01, 02, 03… in order (not the raw
 * semi-random project insertion order Colab actually shows).
 *
 * Auto-filter 2026-10-12 (Vandana): when the signed-in user has a
 * `contractorId`, the list is narrowed to villas where at least one
 * WBS activity belongs to that contractor. Users with no contractorId
 * (planners, admins, product team) see every in-scope villa. Admin
 * surfaces that need the full list regardless of the viewing user can
 * pass `?all=1` to override.
 *
 * Pre-fix, Abraham's engineers on their phone could pick an Elegant
 * villa out of the picker and raise an inspection/permit against it,
 * which just created noise on the wrong contractor's dashboard. This
 * endpoint is the single source for every villa dropdown, so one
 * filter here covers Inspection, Permit, Report, and the Template
 * picker's Activity tab.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const url = new URL(req.url);
  const overrideAll = url.searchParams.get("all") === "1";

  // When the user is tagged to a contractor, resolve the set of villas
  // their contractor has WBS activities on. One query, distinct on
  // villaId, non-null only — a project-level activity (villaId=null)
  // doesn't anchor a villa.
  let villaIdFilter: string[] | null = null;
  if (session.user.contractorId && !overrideAll) {
    const nodes = await prisma.wBSNode.findMany({
      where: {
        projectId,
        contractorId: session.user.contractorId,
        villaId: { not: null },
      },
      select: { villaId: true },
      distinct: ["villaId"],
    });
    villaIdFilter = nodes
      .map((n) => n.villaId)
      .filter((v): v is string => !!v);

    // Defensive guard: a contractor-tagged user whose contractor has
    // zero WBS assignments would otherwise see every villa (empty
    // villaIdFilter + no `in` clause). Explicitly return [] in that
    // case so the picker shows "no villas" rather than everything.
    if (villaIdFilter.length === 0) {
      return NextResponse.json({ villas: [] });
    }
  }

  const villas = await prisma.villa.findMany({
    where: {
      projectId,
      inScope: true,
      ...(villaIdFilter ? { id: { in: villaIdFilter } } : {}),
    },
    select: { id: true, number: true, label: true },
    orderBy: { number: "asc" },
  });

  return NextResponse.json({ villas });
}
