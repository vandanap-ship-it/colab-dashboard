import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { importColabProgress } from "@/lib/colabSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Full sync of a 7k-row Colab export runs ~2 min for dry-run, ~4 min live.
// Keep well under Vercel's 5-min ceiling.
export const maxDuration = 300;

/**
 * POST /api/admin/import-colab-progress
 *
 * Body: JSON { csv: string, projectId: string, dryRun: boolean, projectName?: string }
 *
 * Admin-only. Idempotent. Dry-run returns match counts without writing.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { csv?: string; projectId?: string; dryRun?: boolean; projectName?: string };
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
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const stats = await importColabProgress(prisma, body.projectId, body.csv, {
      dryRun: body.dryRun !== false,
      createdById: session.user.id,
      projectName: body.projectName,
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
