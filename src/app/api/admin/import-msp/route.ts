import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { importMspCsv } from "@/lib/mspImport";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Long-running import (7k+ rows) — extend Vercel's function timeout.
export const maxDuration = 300;

/**
 * POST /api/admin/import-msp
 *
 * Accepts:
 *   - multipart/form-data with fields: file (CSV blob), projectName?
 *   - application/json with { csv: string, projectName?: string }
 *
 * Admin-only. Runs the same idempotent import as scripts/import-msp.ts.
 * Returns per-entity created/updated counts.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let csvText: string | null = null;
  let projectName = "Amanvana";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing 'file' field (CSV upload)" }, { status: 400 });
      }
      if (file.size === 0) {
        return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
      }
      csvText = await file.text();
      const nameField = form.get("projectName");
      if (typeof nameField === "string" && nameField.trim()) projectName = nameField.trim();
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as { csv?: string; projectName?: string };
      if (typeof body.csv !== "string" || body.csv.trim() === "") {
        return NextResponse.json({ error: "JSON body must include 'csv' string" }, { status: 400 });
      }
      csvText = body.csv;
      if (body.projectName) projectName = body.projectName.trim();
    } else {
      return NextResponse.json(
        { error: "Send as multipart/form-data (file field) or application/json (csv field)" },
        { status: 415 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read request body" },
      { status: 400 },
    );
  }

  // Guard rails: sanity-check size + headers so we don't burn a 5-min
  // function on a malformed upload.
  if (csvText.length > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "CSV over 20MB — refusing" }, { status: 413 });
  }
  const firstLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes("Task Name") || !firstLine.includes("Outline Level")) {
    return NextResponse.json(
      { error: "CSV header doesn't look right — expected columns like 'Task Name', 'Outline Level' (produced by scripts/convert-mpp.py)" },
      { status: 400 },
    );
  }

  try {
    const t0 = Date.now();
    const stats = await importMspCsv(prisma, {
      csvText,
      projectName,
      creatorUsername: session.user.username,
    });
    const elapsedMs = Date.now() - t0;

    if (stats.projectId) {
      await recordAudit({
        projectId: stats.projectId,
        userId: session.user.id,
        action: "CREATE",
        entityType: "Project",
        entityId: stats.projectId,
        summary: `MSP import: ${stats.blocks.created + stats.blocks.updated} blocks, ${stats.villas.created + stats.villas.updated} villas, ${stats.wbsNodes.created + stats.wbsNodes.updated} tasks`,
      });
    }

    return NextResponse.json({ ok: true, elapsedMs, stats });
  } catch (e) {
    console.error("[import-msp] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 },
    );
  }
}
