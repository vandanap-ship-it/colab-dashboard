import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAccessModule, MODULES } from "@/lib/modules";
import {
  PERMIT_CATEGORIES,
  effectivePermitStatus,
  validateCreatePermit,
  type PermitStatus,
} from "@/lib/permit";
import { parseBody } from "@/lib/parseBody";

const PostPermitSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  number: z.string().max(80).nullable().optional(),
  issuingAuthority: z.string().min(1).max(200),
  category: z.enum(PERMIT_CATEGORIES),
  issuedDate: z.string(),
  expiryDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  documentUrl: z.string().url().max(2000).nullable().optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
  renewalReminderDays: z.number().int().min(0).max(365).optional(),
});

const PERMIT_INCLUDE = {
  responsible: { select: { id: true, name: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
    return NextResponse.json({ permits: [], counts: { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, RENEWED: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const permits = await prisma.permit.findMany({
    where: { projectId },
    // Priority: EXPIRED first (loudest), then EXPIRING_SOON, then ACTIVE, then RENEWED.
    orderBy: [{ expiryDate: "asc" }, { name: "asc" }],
    include: PERMIT_INCLUDE,
  });

  // Effective status uses the derived rule so counts stay accurate even if
  // nobody has clicked "Renewed" yet.
  const today = new Date();
  const counts: Record<PermitStatus, number> = { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, RENEWED: 0 };
  for (const p of permits) {
    const s = effectivePermitStatus({
      storedStatus: p.status as PermitStatus,
      expiryDate: p.expiryDate,
      renewalReminderDays: p.renewalReminderDays,
      today,
    });
    counts[s]++;
  }

  return NextResponse.json({ permits, counts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessModule(session.user.modules, MODULES.PERMIT)) {
    return NextResponse.json({ error: "Your account doesn't have access to permits." }, { status: 403 });
  }

  const parsed = await parseBody(req, PostPermitSchema);
  if (!parsed.ok) return parsed.response;
  const raw = parsed.data;

  // Deeper semantic checks stay inline — date sanity, category-specific rules.
  const errors = validateCreatePermit(raw);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors }, { status: 400 });
  }

  const permit = await prisma.permit.create({
    data: {
      projectId: raw.projectId,
      name: raw.name!.trim(),
      number: raw.number?.trim() || null,
      issuingAuthority: raw.issuingAuthority!.trim(),
      category: raw.category!,
      issuedDate: new Date(raw.issuedDate!),
      expiryDate: raw.expiryDate ? new Date(raw.expiryDate) : null,
      notes: raw.notes?.trim() || null,
      documentUrl: raw.documentUrl?.trim() || null,
      responsibleUserId: raw.responsibleUserId || null,
      renewalReminderDays: raw.renewalReminderDays ?? 30,
      // Start as ACTIVE; the GET route computes the effective status via the
      // canonical rule so it's always fresh.
      status: "ACTIVE",
    },
    include: PERMIT_INCLUDE,
  });

  await recordAudit({
    projectId: raw.projectId,
    userId: session.user.id,
    action: "CREATE",
    entityType: "Permit",
    entityId: permit.id,
    summary: `Permit added: ${permit.name}${permit.number ? ` (${permit.number})` : ""}`,
  });

  return NextResponse.json({ permit }, { status: 201 });
}
