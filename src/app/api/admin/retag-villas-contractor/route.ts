import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A single call can retag ~50 villas × ~175 activities × N ProgressEntry
// each. Give it room but keep well under Vercel's ceiling.
export const maxDuration = 300;

/**
 * POST /api/admin/retag-villas-contractor
 *
 * Rewrite the contractor attribution on WBSNode + ProgressEntry rows
 * that belong to the given villas, when the Colab progress importer
 * fell back to a default contractor for blank Contractor_Name rows.
 *
 * Safety guard: `fromContractorName` is required. Only rows whose
 * current `contractorId` matches that contractor are touched. Rows
 * already tagged to somebody else (a third contractor, or already
 * pointing at `toContractorName`) are left alone.
 *
 * Body:
 *   {
 *     projectId: string,
 *     villaNumbers: number[],          // primary numbers, one entry per pair-row
 *     fromContractorName: string,      // e.g. "Abraham Thomas"
 *     toContractorName: string,        // e.g. "Elegant Construction"
 *     confirm: true,
 *   }
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  villaNumbers: z.array(z.number().int().min(1).max(9999)).min(1).max(500),
  fromContractorName: z.string().min(1).max(200),
  toContractorName: z.string().min(1).max(200),
  confirm: z.literal(true),
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

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Case-insensitive lookups scoped to the project — Contractor is
  // unique on (projectId, name) so a project-scoped filter matches the
  // policy the Colab importer uses.
  const fromContractor = await prisma.contractor.findFirst({
    where: {
      projectId: project.id,
      name: { equals: body.fromContractorName, mode: "insensitive" },
    },
  });
  if (!fromContractor) {
    return NextResponse.json(
      { error: `fromContractor "${body.fromContractorName}" not found on project` },
      { status: 404 },
    );
  }
  if (fromContractor.name.toLowerCase() === body.toContractorName.toLowerCase()) {
    return NextResponse.json(
      { error: `fromContractor and toContractor are the same ("${fromContractor.name}")` },
      { status: 400 },
    );
  }

  // Find target contractor (case-insensitive, project-scoped) so a
  // caller passing "elegant construction" hits the existing "Elegant
  // Construction" row. Otherwise create with the caller's casing +
  // default "Civil" category, matching the Colab importer's convention.
  let toContractor = await prisma.contractor.findFirst({
    where: {
      projectId: project.id,
      name: { equals: body.toContractorName, mode: "insensitive" },
    },
  });
  let createdToContractor = false;
  if (!toContractor) {
    toContractor = await prisma.contractor.create({
      data: {
        projectId: project.id,
        name: body.toContractorName,
        category: "Civil",
        active: true,
      },
    });
    createdToContractor = true;
  }

  const villas = await prisma.villa.findMany({
    where: { projectId: project.id, number: { in: body.villaNumbers } },
    select: { id: true, number: true, label: true },
  });
  const foundNumbers = new Set(villas.map((v) => v.number));
  const missing = body.villaNumbers.filter((n) => !foundNumbers.has(n));
  const villaIds = villas.map((v) => v.id);
  if (villaIds.length === 0) {
    return NextResponse.json({ error: "No matching villas", missing }, { status: 404 });
  }

  // Count what we're about to touch, so the caller can eyeball the
  // scope before trusting the write went where they expected.
  const wbsToUpdate = await prisma.wBSNode.count({
    where: { villaId: { in: villaIds }, contractorId: fromContractor.id },
  });
  const progressToUpdate = await prisma.progressEntry.count({
    where: {
      wbsNode: { villaId: { in: villaIds } },
      contractorId: fromContractor.id,
      deletedAt: null,
    },
  });

  // The writes: WBSNode rows keyed by villaId+current contractor, then
  // ProgressEntry rows the same way through the relation. Wrapping in
  // one transaction so a mid-run failure never leaves the two tables
  // out of sync.
  const [wbsRes, progressRes] = await prisma.$transaction([
    prisma.wBSNode.updateMany({
      where: { villaId: { in: villaIds }, contractorId: fromContractor.id },
      data: { contractorId: toContractor.id },
    }),
    prisma.progressEntry.updateMany({
      where: {
        wbsNode: { villaId: { in: villaIds } },
        contractorId: fromContractor.id,
        deletedAt: null,
      },
      data: { contractorId: toContractor.id },
    }),
  ]);

  await recordAudit({
    projectId: project.id,
    userId: session.user.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: project.id,
    summary: `Re-tag contractor: ${fromContractor.name} → ${toContractor.name} on ${villaIds.length} villas · ${wbsRes.count} WBS + ${progressRes.count} ProgressEntry rows updated`,
    changes: {
      villaNumbers: body.villaNumbers,
      from: fromContractor.name,
      to: toContractor.name,
      wbsUpdated: wbsRes.count,
      progressEntriesUpdated: progressRes.count,
      createdToContractor,
    },
  });

  return NextResponse.json({
    ok: true,
    from: { id: fromContractor.id, name: fromContractor.name },
    to: { id: toContractor.id, name: toContractor.name, created: createdToContractor },
    villasResolved: villas.length,
    villasMissing: missing,
    preCountWBS: wbsToUpdate,
    preCountProgress: progressToUpdate,
    updatedWBS: wbsRes.count,
    updatedProgressEntries: progressRes.count,
  });
}
