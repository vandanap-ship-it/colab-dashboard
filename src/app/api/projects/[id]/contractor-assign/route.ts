import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { badRequest, forbidden, notFound, unauthorized } from "@/lib/apiErrors";

/**
 * Bulk-assign a contractor to WBS activities in a project.
 *
 * Scopes:
 *   - untagged: activities where contractorId is currently NULL (safest default)
 *   - block:    activities under a specific block code (also untagged only)
 *   - villa:    activities under a specific villa number (also untagged only)
 *   - all:      every activity in the project — overrides existing contractor
 *               tags. Requires explicit override=true confirmation.
 *
 * Idempotent: calling twice with the same scope + contractor is a no-op the
 * second time (all rows are already tagged).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canCreateProject(session.user.role)) return forbidden();

  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return notFound();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }

  const { contractorId, scope, blockCode, villaNumber, override } = (body ?? {}) as {
    contractorId?: string;
    scope?: "untagged" | "block" | "villa" | "all";
    blockCode?: string;
    villaNumber?: number;
    override?: boolean;
  };

  if (!contractorId) return badRequest("contractorId required");
  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, projectId },
    select: { id: true, name: true },
  });
  if (!contractor) return badRequest("Contractor not found on this project");

  if (!scope) return badRequest("scope required (untagged | block | villa | all)");
  if (scope === "all" && !override) {
    return badRequest("scope=all overrides existing contractor tags — pass override:true to confirm");
  }
  if (scope === "block" && !blockCode) return badRequest("blockCode required for scope=block");
  if (scope === "villa" && villaNumber == null) return badRequest("villaNumber required for scope=villa");

  // Build the where clause based on scope. Every scope narrows to this project.
  const baseWhere: {
    projectId: string;
    contractorId?: null;
  } = { projectId };
  if (scope !== "all") baseWhere.contractorId = null;

  let villaFilter:
    | { villaMilestone: { villa: { blockId: string } } }
    | { villaMilestone: { villa: { number: number } } }
    | undefined = undefined;

  if (scope === "block") {
    const block = await prisma.block.findFirst({
      where: { projectId, code: blockCode! },
      select: { id: true },
    });
    if (!block) return badRequest(`Block ${blockCode} not found on this project`);
    villaFilter = { villaMilestone: { villa: { blockId: block.id } } };
  } else if (scope === "villa") {
    villaFilter = { villaMilestone: { villa: { number: villaNumber! } } };
  }

  const where = villaFilter ? { ...baseWhere, ...villaFilter } : baseWhere;

  const count = await prisma.wBSNode.count({ where });
  if (count === 0) {
    return NextResponse.json({ updated: 0, message: "No matching activities to update." });
  }

  const result = await prisma.wBSNode.updateMany({
    where,
    data: { contractorId },
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "WBSNode",
    entityId: "bulk",
    summary: `Bulk assigned ${result.count} WBS activities to ${contractor.name} (scope=${scope}${scope === "block" ? ` block=${blockCode}` : ""}${scope === "villa" ? ` villa=${villaNumber}` : ""})`,
  });

  return NextResponse.json({
    updated: result.count,
    contractor: contractor.name,
    scope,
    ...(scope === "block" ? { blockCode } : {}),
    ...(scope === "villa" ? { villaNumber } : {}),
  });
}

/** GET returns a summary of how many activities would be affected per scope,
 *  so the UI can show "X untagged activities" before the admin confirms. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canCreateProject(session.user.role)) return forbidden();

  const { id: projectId } = await params;

  const [totalCount, untaggedCount, contractors, blocks] = await Promise.all([
    prisma.wBSNode.count({ where: { projectId } }),
    prisma.wBSNode.count({ where: { projectId, contractorId: null } }),
    prisma.contractor.findMany({
      where: { projectId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.block.findMany({
      where: { projectId, active: true },
      orderBy: { orderIndex: "asc" },
      select: { code: true },
    }),
  ]);

  return NextResponse.json({
    totalActivities: totalCount,
    untaggedActivities: untaggedCount,
    contractors,
    blockCodes: blocks.map((b) => b.code),
  });
}
