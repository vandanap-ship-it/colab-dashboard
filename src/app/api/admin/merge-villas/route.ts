import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/merge-villas
 *
 * Merge one villa (drop) into another (keep) in the same project, for
 * pairs of physical units that are built as one (e.g. "Villa 03 & 04").
 * The kept villa keeps its own id and all its data; the dropped villa
 * must have zero WBSNodes attached — otherwise the merge is refused
 * to prevent silent activity loss. The dropped villa's VillaMilestone
 * rows cascade away with it.
 *
 * Body:
 *   {
 *     projectName?: string,      // one of these two is required
 *     projectId?: string,
 *     confirm: true,             // guard against accidental calls
 *     pairs: [{
 *       keep: number,            // villa.number to keep
 *       drop: number,            // villa.number to remove
 *       label: string,           // new display label on the kept row
 *       unitCount: number,       // usually 2
 *     }]
 *   }
 */
const BodySchema = z
  .object({
    projectName: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    confirm: z.literal(true),
    pairs: z
      .array(
        z.object({
          keep: z.number().int().min(1).max(9999),
          drop: z.number().int().min(1).max(9999),
          label: z.string().min(1).max(200),
          unitCount: z.number().int().min(1).max(20),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((b) => b.projectName || b.projectId, {
    message: "Provide projectName or projectId",
    path: ["projectName"],
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

  const project = body.projectId
    ? await prisma.project.findUnique({ where: { id: body.projectId } })
    : await prisma.project.findFirst({ where: { name: body.projectName } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const results: Array<
    | { keep: number; drop: number; status: "merged"; keepId: string; dropId: string; deletedMilestones: number }
    | { keep: number; drop: number; status: "skipped"; reason: string }
  > = [];

  for (const p of body.pairs) {
    const keepVilla = await prisma.villa.findUnique({
      where: { projectId_number: { projectId: project.id, number: p.keep } },
    });
    const dropVilla = await prisma.villa.findUnique({
      where: { projectId_number: { projectId: project.id, number: p.drop } },
    });
    if (!keepVilla) {
      results.push({ keep: p.keep, drop: p.drop, status: "skipped", reason: `keep villa ${p.keep} not found` });
      continue;
    }
    if (!dropVilla) {
      results.push({ keep: p.keep, drop: p.drop, status: "skipped", reason: `drop villa ${p.drop} not found` });
      continue;
    }
    if (keepVilla.id === dropVilla.id) {
      results.push({ keep: p.keep, drop: p.drop, status: "skipped", reason: "keep and drop are the same villa" });
      continue;
    }

    // Refuse to drop a villa that has any wBSNodes attached — even one
    // means we'd silently lose activity data. The caller can move those
    // activities out first if they really want the merge.
    const dropActivities = await prisma.wBSNode.count({
      where: {
        OR: [
          { villaId: dropVilla.id },
          { villaMilestone: { villaId: dropVilla.id } },
        ],
      },
    });
    if (dropActivities > 0) {
      results.push({
        keep: p.keep,
        drop: p.drop,
        status: "skipped",
        reason: `drop villa ${p.drop} has ${dropActivities} activities — refusing to delete`,
      });
      continue;
    }

    const dropMilestoneCount = await prisma.villaMilestone.count({ where: { villaId: dropVilla.id } });

    // One transaction per pair so a mid-batch failure doesn't half-merge.
    await prisma.$transaction(async (tx) => {
      await tx.villa.update({
        where: { id: keepVilla.id },
        data: { label: p.label, unitCount: p.unitCount },
      });
      await tx.villa.delete({ where: { id: dropVilla.id } });
    });

    results.push({
      keep: p.keep,
      drop: p.drop,
      status: "merged",
      keepId: keepVilla.id,
      dropId: dropVilla.id,
      deletedMilestones: dropMilestoneCount,
    });
  }

  const merged = results.filter((r) => r.status === "merged").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  await recordAudit({
    projectId: project.id,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: project.id,
    summary: `Villa merge: ${merged} pairs merged, ${skipped} skipped (${body.pairs
      .map((p) => `${p.keep}&${p.drop}`)
      .join(", ")})`,
  });

  return NextResponse.json({ ok: skipped === 0, project: { id: project.id, name: project.name }, results });
}
