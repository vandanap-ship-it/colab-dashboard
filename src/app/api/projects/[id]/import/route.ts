import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { parseWBSCsv, buildTree } from "@/lib/wbsImport";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  unauthorized,
} from "@/lib/apiErrors";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/import">) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!canCreateProject(session.user.role)) return forbidden();

  const { id: projectId } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return notFound("Project not found");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Invalid form data");
  }

  const file = form.get("file");
  const replace = form.get("replace") === "true";

  if (!(file instanceof File)) return badRequest("Missing CSV file");
  if (file.size > 5 * 1024 * 1024) {
    return badRequest("CSV file too large (max 5 MB)");
  }

  let csv: string;
  try {
    csv = await file.text();
  } catch {
    return badRequest("Could not read file (not UTF-8?)");
  }

  const parsed = parseWBSCsv(csv);
  if (!parsed.ok) return badRequest(parsed.error);

  const existingCount = await prisma.wBSNode.count({ where: { projectId } });
  if (existingCount > 0 && !replace) {
    return NextResponse.json(
      {
        error: `Project already has ${existingCount} WBS rows. Pass replace=true to wipe and reimport.`,
      },
      { status: 409 },
    );
  }

  const tree = buildTree(parsed.rows);

  // Resolve contractor names (per-project) into IDs; create on the fly if missing.
  const contractorNames = Array.from(
    new Set(tree.nodes.map((n) => n.contractorName).filter((x): x is string => !!x)),
  );
  const contractorMap = new Map<string, string>();

  try {
    for (const name of contractorNames) {
      const c = await prisma.contractor.upsert({
        where: { projectId_name: { projectId, name } },
        update: {},
        create: { projectId, name, category: "Imported" },
      });
      contractorMap.set(name, c.id);
    }

    const result = await prisma.$transaction(async (tx) => {
      if (replace) {
        await tx.wBSNode.deleteMany({ where: { projectId } });
      }

      // Two-pass insert: first all nodes (without parentId), then connect parents.
      const codeToId = new Map<string, string>();

      for (const n of tree.nodes) {
        let taskCode = n.taskCode;
        if (codeToId.has(taskCode)) {
          taskCode = `${taskCode}#${n.rowIndex}`;
        }
        const created = await tx.wBSNode.create({
          data: {
            projectId,
            taskCode,
            name: n.name,
            level: n.level,
            orderIndex: n.orderIndex,
            baselineStart: n.baselineStart,
            baselineFinish: n.baselineFinish,
            actualStart: n.actualStart,
            actualFinish: n.actualFinish,
            projectedFinish: n.projectedFinish,
            percentComplete: n.percentComplete,
            category: n.category,
            predecessorsRaw: n.predecessorsRaw,
            totalQuantity: n.totalQuantity,
            unit: n.unit,
            contractorId: n.contractorName ? contractorMap.get(n.contractorName) ?? null : null,
          },
          select: { id: true },
        });
        codeToId.set(taskCode, created.id);
        n.taskCode = taskCode;
      }

      // Second pass: set parentId
      for (const n of tree.nodes) {
        if (!n.parentTaskCode) continue;
        const parentId = codeToId.get(n.parentTaskCode);
        if (!parentId) continue;
        const id = codeToId.get(n.taskCode);
        if (!id) continue;
        await tx.wBSNode.update({ where: { id }, data: { parentId } });
      }

      return { inserted: tree.nodes.length };
    });

    return NextResponse.json({
      inserted: result.inserted,
      warnings: parsed.warnings,
    });
  } catch (e) {
    return handleApiError(e, "POST /api/projects/:id/import");
  }
}
