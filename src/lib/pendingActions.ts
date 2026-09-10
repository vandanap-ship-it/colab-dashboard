import "server-only";

import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";

/**
 * Count of "items waiting on you" for the mobile Info tab badge and the
 * hero card on /mobile/[projectId]/info. Kept in one place so the badge
 * count and the destination page always agree.
 *
 * Definition:
 *   - concerns explicitly assigned to me and still open (TASK_ASSIGNED or PENDING)
 *   - snags (Issues) explicitly assigned to me and still OPEN
 *   - inspections in IN_REVIEW status — only for reviewers (planner /
 *     product / admin); anyone else sees 0 from this bucket
 *
 * Site engineers therefore see just their assigned concerns + snags; a
 * planner reviewing inspections sees those too. Kept intentionally small
 * — a nav badge that shows 40 loses its meaning fast.
 */
export async function getPendingActionCount(
  projectId: string,
  userId: string,
  role: string,
): Promise<number> {
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;
  const [concernsAssigned, issuesAssigned, inspectionsToReview] = await Promise.all([
    prisma.concern.count({
      where: {
        projectId,
        status: { in: ["TASK_ASSIGNED", "PENDING"] },
        assignedToId: userId,
      },
    }),
    prisma.issue.count({ where: { projectId, status: "OPEN", assignedToId: userId } }),
    canReviewInspections
      ? prisma.inspection.count({ where: { projectId, status: "IN_REVIEW" } })
      : Promise.resolve(0),
  ]);
  return concernsAssigned + issuesAssigned + inspectionsToReview;
}
