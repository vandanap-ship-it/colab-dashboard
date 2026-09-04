import { prisma } from "@/lib/prisma";

/**
 * Cross-project FK guards.
 *
 * Several POST handlers accept both `projectId` and an activity FK
 * (`wbsNodeId`) in the request body. Without a check, a client can post
 * `projectId: "A", wbsNodeId: "node-in-project-B"` and end up with a snag /
 * hindrance / inspection / RFI / concern that's linked to an activity in a
 * different project than it claims to belong to — reports double-count,
 * dashboards mis-attribute, and scoped contractors can be tricked into
 * mutating records that visually appear to be theirs.
 *
 * These helpers do the minimum lookup needed to reject that shape.
 */

/**
 * Verify `wbsNodeId` belongs to `projectId`. Returns `null` on success or
 * when `wbsNodeId` is nullish, `string` (an error message) on mismatch.
 *
 * Call sites should:
 *   const err = await assertWbsNodeInProject(wbsNodeId, projectId);
 *   if (err) return badRequest(err);
 */
export async function assertWbsNodeInProject(
  wbsNodeId: string | null | undefined,
  projectId: string,
): Promise<string | null> {
  if (!wbsNodeId) return null;
  const node = await prisma.wBSNode.findFirst({
    where: { id: wbsNodeId, projectId },
    select: { id: true },
  });
  if (!node) {
    return "Activity does not belong to this project";
  }
  return null;
}

/**
 * Bulk version for endpoints that accept an array of line items each with an
 * optional `wbsNodeId` (e.g. bill lines). Runs one query for the whole set.
 */
export async function assertWbsNodesInProject(
  wbsNodeIds: Array<string | null | undefined>,
  projectId: string,
): Promise<string | null> {
  const uniques = Array.from(
    new Set(wbsNodeIds.filter((x): x is string => typeof x === "string" && x.length > 0)),
  );
  if (uniques.length === 0) return null;
  const found = await prisma.wBSNode.findMany({
    where: { id: { in: uniques }, projectId },
    select: { id: true },
  });
  if (found.length !== uniques.length) {
    return "One or more line items reference an activity in a different project";
  }
  return null;
}
