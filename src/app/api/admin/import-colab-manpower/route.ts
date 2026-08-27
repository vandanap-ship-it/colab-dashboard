import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { importColabManpower } from "@/lib/colabManpowerImport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/admin/import-colab-manpower
 *
 * Body: JSON {
 *   csv: string,
 *   projectId: string,
 *   dryRun: boolean,
 *   projectName?: string,
 *   ignoreContractors?: string[],
 *   tradeAliases?: { [colabTrade]: siddhiTrade }
 * }
 *
 * Admin-only. Idempotent.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: {
    csv?: string;
    projectId?: string;
    dryRun?: boolean;
    projectName?: string;
    ignoreContractors?: string[];
    tradeAliases?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!body.csv || !body.projectId) {
    return NextResponse.json({ error: "csv and projectId are required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const stats = await importColabManpower(prisma, body.projectId, body.csv, {
      dryRun: body.dryRun !== false,
      createdById: session.user.id,
      projectName: body.projectName,
      ignoreContractors: body.ignoreContractors,
      tradeAliases: body.tradeAliases,
    });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[colab-manpower-sync] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
