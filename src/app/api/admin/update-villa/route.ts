import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/update-villa
 *
 * Patch a Villa row's display metadata — `label`, `unitCount`,
 * `inScope`. Nothing structural (block, number, project) moves.
 * Requires projectId + villaNumber + confirm:true.
 *
 * Motivating case: undoing an earlier villa merge. When a "combined"
 * pair (03 & 04) turns out to be two independent builds, we split the
 * dropped villa back out via /api/admin/import-msp scoped mode, then
 * use this endpoint to reset the kept villa's label back to `null`
 * and unitCount to 1.
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  villaNumber: z.number().int().min(1).max(9999),
  confirm: z.literal(true),
  // Every field below is optional. `null` on label unsets it; omitting
  // a field leaves the current value alone.
  label: z.string().max(200).nullable().optional(),
  unitCount: z.number().int().min(1).max(20).optional(),
  inScope: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const existing = await prisma.villa.findUnique({
    where: { projectId_number: { projectId: body.projectId, number: body.villaNumber } },
  });
  if (!existing) return NextResponse.json({ error: "Villa not found" }, { status: 404 });

  // Build the patch — only include keys the caller actually sent so we
  // don't overwrite a field with `undefined` implicitly.
  const data: { label?: string | null; unitCount?: number; inScope?: boolean } = {};
  if (Object.prototype.hasOwnProperty.call(body, "label")) data.label = body.label ?? null;
  if (body.unitCount !== undefined) data.unitCount = body.unitCount;
  if (body.inScope !== undefined) data.inScope = body.inScope;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true, villa: existing });
  }

  const updated = await prisma.villa.update({
    where: { id: existing.id },
    data,
    select: { id: true, number: true, label: true, unitCount: true, inScope: true },
  });

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if ("label" in data && existing.label !== updated.label) changes.label = { from: existing.label, to: updated.label };
  if ("unitCount" in data && existing.unitCount !== updated.unitCount) changes.unitCount = { from: existing.unitCount, to: updated.unitCount };
  if ("inScope" in data && existing.inScope !== updated.inScope) changes.inScope = { from: existing.inScope, to: updated.inScope };

  await recordAudit({
    projectId: body.projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: existing.id,
    summary: `Villa ${existing.number} updated via /api/admin/update-villa (${Object.keys(changes).join(", ") || "no-op"})`,
    changes,
  });

  return NextResponse.json({ ok: true, villa: updated, changes });
}
