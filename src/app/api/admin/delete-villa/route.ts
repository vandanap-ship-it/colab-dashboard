import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/delete-villa
 *
 * Hard-delete a Villa row (and everything under it via ON DELETE
 * CASCADE — VillaMilestone rows + linked WBSNode.villaId references).
 *
 * Guarded by requiring BOTH projectId and villaNumber + confirm:true.
 * Refuses when the villa has any ProgressEntry rows attached (via its
 * WBSNodes) unless `force: true` — that's the "sitting on real user
 * data" safety net. `force` is intentional: an admin actively saying
 * "I know I'm nuking site-entered progress on this villa."
 *
 * Motivating case: post-merge cleanup. When "Villa 03 & 04" is one
 * physical build, we import both sides from MPP first, then use this
 * route to drop Villa 04 so we can relabel Villa 03 as the combined
 * pair via /api/admin/update-villa.
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  villaNumber: z.number().int().min(1).max(9999),
  confirm: z.literal(true),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const villa = await prisma.villa.findUnique({
    where: { projectId_number: { projectId: body.projectId, number: body.villaNumber } },
  });
  if (!villa) return NextResponse.json({ error: "Villa not found" }, { status: 404 });

  const [wbsCount, milestoneCount, progressCount] = await Promise.all([
    prisma.wBSNode.count({ where: { villaId: villa.id } }),
    prisma.villaMilestone.count({ where: { villaId: villa.id } }),
    prisma.progressEntry.count({
      where: { wbsNode: { villaId: villa.id }, deletedAt: null },
    }),
  ]);

  if (progressCount > 0 && !body.force) {
    return NextResponse.json(
      {
        error: `Villa ${body.villaNumber} has ${progressCount} ProgressEntry rows attached — refusing to delete without force:true.`,
        cascadeCounts: { wbs: wbsCount, milestones: milestoneCount, progressEntries: progressCount },
      },
      { status: 400 },
    );
  }

  await recordAudit({
    projectId: body.projectId,
    userId: session.user.id,
    action: "DELETE",
    entityType: "Project",
    entityId: villa.id,
    summary: `Hard-delete Villa ${villa.number}${villa.label ? ` (${villa.label})` : ""} — ${wbsCount} WBS + ${milestoneCount} milestones + ${progressCount} ProgressEntry rows cascade${body.force ? " (force)" : ""}`,
    changes: {
      villaId: villa.id,
      villaNumber: villa.number,
      label: villa.label,
      cascadeCounts: { wbs: wbsCount, milestones: milestoneCount, progressEntries: progressCount },
      force: body.force ?? false,
    },
  });

  await prisma.villa.delete({ where: { id: villa.id } });

  return NextResponse.json({
    ok: true,
    deleted: { id: villa.id, number: villa.number, label: villa.label },
    cascadeCounts: { wbs: wbsCount, milestones: milestoneCount, progressEntries: progressCount },
  });
}
