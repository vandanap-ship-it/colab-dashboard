import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isScopedUser } from "@/lib/modules";

/**
 * Compact index for the mobile activity picker. Returns:
 *   - blocks[] with villas[] with villaMilestones[]  (~40KB for Amanvana)
 *   - recent[]  — last 10 activities logged by THIS user, most recent first
 *
 * The site engineer taps a block → villa → milestone, then the follow-up
 * endpoint /activities/for-milestone/[id] fetches just those leaf activities
 * (usually 5-15 items). Total network transfer for a typical progress log
 * drops from ~500KB (loading all 7,000 activities) to ~50KB total.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isScopedUser(session.user.modules)) {
    return NextResponse.json({ blocks: [], recent: [] });
  }

  const { id: projectId } = await params;

  const [blocks, recentEntries] = await Promise.all([
    prisma.block.findMany({
      where: { projectId, active: true },
      orderBy: { orderIndex: "asc" },
      select: {
        code: true,
        name: true,
        villas: {
          orderBy: { number: "asc" },
          where: { inScope: true },
          select: {
            id: true,
            number: true,
            label: true,
            milestones: {
              orderBy: { section: { orderIndex: "asc" } },
              select: {
                id: true,
                pctComplete: true,
                actualFinish: true,
                section: { select: { name: true, code: true, orderIndex: true } },
              },
            },
          },
        },
      },
    }),
    prisma.progressEntry.findMany({
      where: {
        projectId,
        createdById: session.user.id,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 25, // fetch a few extras since some may dedupe to the same wbsNode
      select: {
        wbsNode: {
          select: {
            id: true,
            name: true,
            taskCode: true,
            villaMilestoneId: true,
            villaMilestone: {
              select: {
                villa: {
                  select: {
                    number: true,
                    label: true,
                    block: { select: { code: true } },
                  },
                },
                section: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const compactBlocks = blocks.map((b) => ({
    code: b.code,
    name: b.name,
    villas: b.villas.map((v) => ({
      id: v.id,
      number: v.number,
      label: v.label ?? `Villa ${v.number}`,
      milestones: v.milestones.map((m) => ({
        id: m.id,
        name: m.section?.name ?? "—",
        code: m.section?.code ?? "",
        pctComplete: Math.round((m.pctComplete ?? 0)),
        done: !!m.actualFinish,
      })),
    })),
  }));

  // Dedupe recent by wbsNode.id (a user often logs same activity multiple days).
  const seen = new Set<string>();
  const recent: Array<{
    id: string;
    name: string;
    taskCode: string;
    villaLabel: string;
    blockCode: string;
    sectionName: string;
  }> = [];
  for (const e of recentEntries) {
    const n = e.wbsNode;
    if (!n?.id || seen.has(n.id)) continue;
    seen.add(n.id);
    const vm = n.villaMilestone;
    if (!vm?.villa) continue;
    recent.push({
      id: n.id,
      name: n.name,
      taskCode: n.taskCode,
      villaLabel: vm.villa.label ?? `Villa ${vm.villa.number}`,
      blockCode: vm.villa.block.code,
      sectionName: vm.section?.name ?? "—",
    });
    if (recent.length >= 10) break;
  }

  return NextResponse.json({ blocks: compactBlocks, recent });
}
