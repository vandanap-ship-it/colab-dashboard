import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { importColabManpower } from "@/lib/colabManpowerImport";
import { parseBody } from "@/lib/parseBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CSV_BYTES = 20 * 1024 * 1024;

const PostSchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  projectId: z.string().min(1),
  dryRun: z.boolean().optional(),
  projectName: z.string().max(200).optional(),
  ignoreContractors: z.array(z.string().max(200)).max(1000).optional(),
  // tradeAliases is a small map like { "MASON": "MASONRY" } — bound the key
  // and value lengths so a runaway payload can't blow past json parser limits.
  tradeAliases: z.record(z.string().max(100), z.string().max(100)).optional(),
});

/**
 * POST /api/admin/import-colab-manpower
 *
 * Body: JSON {
 *   csv: string,
 *   projectId: string,
 *   dryRun?: boolean,
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

  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

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
