import "server-only";

import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";

/**
 * Count of "items waiting on you" for the mobile Info tab badge and the
 * hero card on /mobile/[projectId]/info. Kept in one place so the badge
 * count and the destination page always agree.
 *
 * Definition (matches /mobile/[projectId]/my-actions exactly — same queries,
 * same filters, so the badge and the page always agree):
 *   - concerns explicitly assigned to me and still open (TASK_ASSIGNED or PENDING)
 *   - snags (Issues) explicitly assigned to me and still OPEN
 *   - RFIs explicitly assigned to me and still OPEN
 *   - work permits pending my approval (my id in approverIds JSON string)
 *   - inspections in IN_REVIEW status — only for reviewers (planner /
 *     product / admin); anyone else sees 0 from this bucket
 *
 * Site engineers therefore see just their assigned rows; a planner
 * reviewing inspections and approving permits sees those too. Kept
 * small — a nav badge that shows 40 loses its meaning fast.
 */
export async function getPendingActionCount(
  projectId: string,
  userId: string,
  role: string,
): Promise<number> {
  const canReviewInspections =
    role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;
  const [concernsAssigned, issuesAssigned, rfisAssigned, permitsToApprove, inspectionsToReview] =
    await Promise.all([
      prisma.concern.count({
        where: {
          projectId,
          status: { in: ["TASK_ASSIGNED", "PENDING"] },
          assignedToId: userId,
        },
      }),
      prisma.issue.count({ where: { projectId, status: "OPEN", assignedToId: userId } }),
      prisma.rfi.count({ where: { projectId, status: "OPEN", assignedToId: userId } }),
      prisma.workPermit.count({
        where: { projectId, status: "PENDING", approverIds: { contains: userId } },
      }),
      canReviewInspections
        ? prisma.inspection.count({ where: { projectId, status: "IN_REVIEW" } })
        : Promise.resolve(0),
    ]);
  return (
    concernsAssigned +
    issuesAssigned +
    rfisAssigned +
    permitsToApprove +
    inspectionsToReview
  );
}
