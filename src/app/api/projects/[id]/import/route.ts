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

    // Pre-generate IDs so we can batch insert + know parent IDs without
    // re-querying. Avoids 384 sequential round-trips on Vercel (which times
    // out the function long before completing the import).
    const idFor = (() => {
      const used = new Set<string>();
      const generate = () => {
        // Cuid-like 24-char id (good enough for our use; collision-free for one batch).
        const s =
          "c" +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 10) +
          Math.random().toString(36).slice(2, 10);
        return s.slice(0, 24);
      };
      return () => {
        let id = generate();
        while (used.has(id)) id = generate();
        used.add(id);
        return id;
      };
    })();

    const codeToId = new Map<string, string>();
    for (const n of tree.nodes) {
      let taskCode = n.taskCode;
      if (codeToId.has(taskCode)) taskCode = `${taskCode}#${n.rowIndex}`;
      n.taskCode = taskCode;
      codeToId.set(taskCode, idFor());
    }

    const records = tree.nodes.map((n) => ({
      id: codeToId.get(n.taskCode)!,
      projectId,
      taskCode: n.taskCode,
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
      progressEntered: n.progressEntered,
      contractorId: n.contractorName ? contractorMap.get(n.contractorName) ?? null : null,
      parentId: n.parentTaskCode ? codeToId.get(n.parentTaskCode) ?? null : null,
    }));

    const result = await prisma.$transaction(async (tx) => {
      if (replace) {
        await tx.wBSNode.deleteMany({ where: { projectId } });
      }
      // Batched insert in chunks (libSQL caps single statement size).
      const CHUNK = 100;
      for (let i = 0; i < records.length; i += CHUNK) {
        await tx.wBSNode.createMany({ data: records.slice(i, i + CHUNK) });
      }
      return { inserted: records.length };
    });

    return NextResponse.json({
      inserted: result.inserted,
      warnings: parsed.warnings,
    });
  } catch (e) {
    return handleApiError(e, "POST /api/projects/:id/import");
  }
}
