import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { badRequest, unauthorized, handleApiError } from "@/lib/apiErrors";
import { findRegister, loadRows, toLoadedType } from "@/lib/registersServer";

/**
 * GET ?templateCode=CL-SAF-03 → the register linked to that checklist
 * template on this project, plus its live rows, so the inspection form
 * can offer an item picker ("Which extinguisher?").
 * GET ?registerRowId=… → same, resolved from a row (resuming a draft,
 * where the template isn't stored on the inspection). Returns
 * { register: null } when the template isn't linked to any register or
 * the caller can't see that register's module.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: projectId } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const templateCode = sp.get("templateCode");
    const registerRowId = sp.get("registerRowId");
    if (!templateCode && !registerRowId) return badRequest("templateCode or registerRowId required");

    const t = templateCode
      ? await prisma.registerType.findFirst({ where: { inspectionTemplateCode: templateCode, active: true } })
      : (
          await prisma.registerRow.findUnique({
            where: { id: registerRowId! },
            select: { register: { select: { projectId: true, type: true } } },
          })
        )?.register.type ?? null;
    if (!t || !canAccessModule(session.user.modules, t.module as ModuleKey)) {
      return NextResponse.json({ register: null });
    }
    const type = toLoadedType(t);
    const register = await findRegister(projectId, type.id);
    const rows = register ? (await loadRows(register.id)).filter((r) => !r.retiredAt) : [];
    return NextResponse.json({
      register: {
        code: type.code,
        shortName: type.shortName,
        identifierKey: type.identifierKey,
        columns: type.columns,
        rows: rows.map((r) => ({ id: r.id, identifier: r.identifier, values: r.values })),
      },
    });
  } catch (e) {
    return handleApiError(e, "registers/linked GET");
  }
}
