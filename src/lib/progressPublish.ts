import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail, milestoneCompletionEmail } from "@/lib/email";

const SIDDHI_BASE_URL = process.env.SIDDHI_BASE_URL || "https://siddhi-whitelotus.vercel.app";

/**
 * Fires the milestone-completion email if the given WBS node is a
 * sub-milestone that just crossed to actualFinish. Silent no-op
 * otherwise (regular activities, non-milestone rows, missing villa
 * link, or when RESEND_API_KEY isn't configured on the deployment).
 *
 * Extracted from the POST /api/progress + PATCH /api/progress/[id]
 * routes so the new /publish endpoint can reuse the same behaviour
 * without duplicating 30 lines of joins + template setup.
 */
export async function maybeSendMilestoneCompletionEmail(
  wbsNodeId: string,
  actualFinishDate: Date,
): Promise<void> {
  const node = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: {
      isSubMilestone: true,
      villaMilestone: {
        select: {
          baselineFinish: true,
          villa: {
            select: {
              number: true,
              label: true,
              project: { select: { id: true, name: true } },
            },
          },
          section: { select: { name: true } },
        },
      },
    },
  });
  if (!node?.isSubMilestone) return;
  const vm = node.villaMilestone;
  if (!vm) return;
  await sendEmail(
    milestoneCompletionEmail({
      projectName: vm.villa.project.name,
      villaLabel: vm.villa.label ?? `Villa ${vm.villa.number}`,
      sectionName: vm.section?.name ?? "Milestone",
      actualFinish: actualFinishDate,
      baselineFinish: vm.baselineFinish,
      dashboardUrl: `${SIDDHI_BASE_URL}/projects/${vm.villa.project.id}/overview?vn=${vm.villa.number}`,
    }),
  );
}
