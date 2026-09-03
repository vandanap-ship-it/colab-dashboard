import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { importColabProgress } from "@/lib/colabSync";
import { parseBody } from "@/lib/parseBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Full sync of a 7k-row Colab export runs ~2 min for dry-run, ~4 min live.
// Keep well under Vercel's 5-min ceiling.
export const maxDuration = 300;

// Colab progress exports run large — 7k rows is ~2MB, so leave generous
// headroom rather than reject a valid file at the edge.
const MAX_CSV_BYTES = 20 * 1024 * 1024;

const PostSchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  projectId: z.string().min(1),
  dryRun: z.boolean().optional(),
  projectName: z.string().max(200).optional(),
  defaultContractorName: z.string().max(200).optional(),
});

/**
 * POST /api/admin/import-colab-progress
 *
 * Body: JSON { csv: string, projectId: string, dryRun?: boolean,
 *              projectName?: string, defaultContractorName?: string }
 *
 * Admin-only. Idempotent. Dry-run (the default) returns match counts
 * without writing anything.
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
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const stats = await importColabProgress(prisma, body.projectId, body.csv, {
      dryRun: body.dryRun !== false,
      createdById: session.user.id,
      projectName: body.projectName,
      defaultContractorName: body.defaultContractorName,
    });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[colab-sync] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
