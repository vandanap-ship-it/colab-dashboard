import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Unauthed smoke-test endpoint: how many inspection templates are seeded
 * right now, and which codes. Deliberately no auth — the numbers here are
 * schema-shaped (are checklists seeded at all?), not user-shaped, and
 * every published version of the data file lists the same codes in git,
 * so nothing new leaks. Kept out of the main `/api/inspection-templates`
 * handler because that one is scoped-per-user and we want a stable
 * public probe.
 *
 * Consumed by:
 *   - post-deploy verification (see /docs/deploy — verify the build's
 *     seed step actually converged)
 *   - scripts/smoke-prod.ts as a lightweight canary
 */
export async function GET() {
  const rows = await prisma.inspectionTemplate.findMany({
    where: { active: true },
    orderBy: { orderIndex: "asc" },
    select: { code: true, name: true, orderIndex: true, _count: { select: { items: true } } },
  });
  return NextResponse.json({
    count: rows.length,
    templates: rows.map((r) => ({
      code: r.code,
      name: r.name,
      orderIndex: r.orderIndex,
      items: r._count.items,
    })),
  });
}
