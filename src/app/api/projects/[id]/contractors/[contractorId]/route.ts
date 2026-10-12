import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import { parseBody } from "@/lib/parseBody";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/projects/[id]/contractors/[contractorId]
 *
 * Admin-only. Toggles Contractor.showInPickers (the mobile picker
 * visibility flag). Does NOT soft-delete. Rows still exist, existing
 * references stay valid, reports still roll them up — the flag only
 * affects which contractors appear in the mobile New Progress /
 * Inspection / Permit contractor dropdowns.
 *
 * Written 2026-10-12 to let Vandana hide the three labour-supply
 * vendors (Achyutananda Naik, Nilakar, Sanjay Das) that the Oct 1
 * safety induction import auto-created, without destroying their
 * safety-induction rows.
 */

const PatchSchema = z.object({
  showInPickers: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; contractorId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canCreateProject(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id: projectId, contractorId } = await ctx.params;
  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.showInPickers === undefined) {
    return NextResponse.json({ error: "No supported field to update" }, { status: 400 });
  }

  const existing = await prisma.contractor.findFirst({
    where: { id: contractorId, projectId },
    select: { id: true, name: true, showInPickers: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contractor not found on this project" }, { status: 404 });
  }

  if (existing.showInPickers === body.showInPickers) {
    return NextResponse.json({ contractor: existing });
  }

  const updated = await prisma.contractor.update({
    where: { id: contractorId },
    data: { showInPickers: body.showInPickers },
    select: { id: true, name: true, showInPickers: true },
  });

  await recordAudit({
    projectId,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Contractor",
    entityId: contractorId,
    summary: `${updated.name}: showInPickers ${existing.showInPickers} -> ${updated.showInPickers}`,
    changes: {
      showInPickers: {
        from: existing.showInPickers,
        to: updated.showInPickers,
      },
    },
  });

  return NextResponse.json({ contractor: updated });
}
