import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parseBody";

const PostClearSchema = z.object({
  confirm: z.literal("CLEAR_TEST_DATA", {
    message: 'Body must include { "confirm": "CLEAR_TEST_DATA" } to actually delete.',
  }),
  resetWbs: z.boolean().optional(),
});

async function summarise() {
  // Soft-delete filtered models return "live rows only" via the prisma
  // extension — that's what the site team actually sees, so it's the right
  // number to report. The DELETE path below hard-deletes both live and
  // trashed rows so nothing survives, but a re-run of summarise after the
  // wipe will show zero either way.
  const [
    users,
    projects,
    contractors,
    wbsNodes,
    progress,
    progressLabour,
    progressPhotos,
    issues,
    issuePhotos,
    hindrances,
    hindrancePhotos,
    concerns,
    concernPhotos,
    inspections,
    inspectionItems,
    inspectionPhotos,
    rfis,
    rfiPhotos,
    permits,
    manpowerEntries,
    tradePlans,
    bills,
    billLines,
    expenses,
    expensePhotos,
    projectDrawings,
    designDrawings,
    designDrawingRevisions,
    wbsWithActuals,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.contractor.count(),
    prisma.wBSNode.count(),
    prisma.progressEntry.count(),
    prisma.progressLabour.count(),
    prisma.progressPhoto.count(),
    prisma.issue.count(),
    prisma.issuePhoto.count(),
    prisma.hindrance.count(),
    prisma.hindrancePhoto.count(),
    prisma.concern.count(),
    prisma.concernPhoto.count(),
    prisma.inspection.count(),
    prisma.inspectionItem.count(),
    prisma.inspectionPhoto.count(),
    prisma.rfi.count(),
    prisma.rfiPhoto.count(),
    prisma.permit.count(),
    prisma.manpowerEntry.count(),
    prisma.tradePlan.count(),
    prisma.subContractorBill.count(),
    prisma.subContractorBillLine.count(),
    prisma.expense.count(),
    prisma.expensePhoto.count(),
    prisma.projectDrawing.count(),
    prisma.designDrawing.count(),
    prisma.designDrawingRevision.count(),
    prisma.wBSNode.count({
      where: {
        OR: [
          { actualStart: { not: null } },
          { actualFinish: { not: null } },
          { projectedFinish: { not: null } },
          { percentComplete: { gt: 0 } },
          { delayReason: { not: null } },
        ],
      },
    }),
  ]);

  return {
    keeping: { users, projects, contractors, wbsNodes },
    wiping: {
      progressEntries: progress,
      progressLabour,
      progressPhotos,
      issues,
      issuePhotos,
      hindrances,
      hindrancePhotos,
      concerns,
      concernPhotos,
      inspections,
      inspectionItems,
      inspectionPhotos,
      rfis,
      rfiPhotos,
      permits,
      manpowerEntries,
      tradePlans,
      bills,
      billLines,
      expenses,
      expensePhotos,
      projectDrawings,
      designDrawings,
      designDrawingRevisions,
    },
    resetting: { wbsNodesWithNonDefaultRuntime: wbsWithActuals },
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const before = await summarise();
  return NextResponse.json({ mode: "dry-run", before });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Production guard. This endpoint hard-deletes all progress logs, hindrances,
  // concerns, issues, inspections and their photos across every project. Once
  // real users are on the tool that is unacceptable data-loss surface, even
  // for an authenticated admin. Require an explicit env var to be set on the
  // running server before the deletion path is reachable — a compromised
  // admin session by itself can't wipe prod.
  if (process.env.ALLOW_DATA_WIPE !== "yes") {
    return NextResponse.json(
      {
        error:
          "Disabled on this deployment. Set ALLOW_DATA_WIPE=yes on the server (and restart) to enable — intended for pre-launch test-data cleanup only.",
      },
      { status: 403 },
    );
  }

  const parsed = await parseBody(req, PostClearSchema);
  if (!parsed.ok) return parsed.response;
  const resetWbs = parsed.data.resetWbs === true;
  const before = await summarise();

  const result = await prisma.$transaction(async (tx) => {
    // Photo/child tables where the cascade isn't declared — clear them
    // first. For SubContractorBillLine, ExpensePhoto, RfiPhoto and
    // DesignDrawingRevision the parent-side onDelete: Cascade takes care
    // of it, so we only need the parent deleteMany.
    const ipDel = await tx.inspectionPhoto.deleteMany();
    const iiDel = await tx.inspectionItem.deleteMany();
    const insDel = await tx.inspection.deleteMany();

    const cpDel = await tx.concernPhoto.deleteMany();
    const cDel = await tx.concern.deleteMany();

    const hpDel = await tx.hindrancePhoto.deleteMany();
    const hDel = await tx.hindrance.deleteMany();

    const issPDel = await tx.issuePhoto.deleteMany();
    const issDel = await tx.issue.deleteMany();

    const ppDel = await tx.progressPhoto.deleteMany();
    const plDel = await tx.progressLabour.deleteMany();
    const pDel = await tx.progressEntry.deleteMany();

    // Newly-added test-data wipes — the pre-launch walkthrough will
    // exercise these modules and their rows have to disappear too, else
    // ghost RFIs / permits / expenses linger in prod after the reset.
    const rfiDel = await tx.rfi.deleteMany(); // cascades RfiPhoto
    const permitDel = await tx.permit.deleteMany();
    const manpowerDel = await tx.manpowerEntry.deleteMany();
    const tradePlanDel = await tx.tradePlan.deleteMany();
    const expenseDel = await tx.expense.deleteMany(); // cascades ExpensePhoto
    const billDel = await tx.subContractorBill.deleteMany(); // cascades SubContractorBillLine
    const projectDrawingDel = await tx.projectDrawing.deleteMany();
    const designDrawingDel = await tx.designDrawing.deleteMany(); // cascades DesignDrawingRevision

    const wbsReset = resetWbs
      ? await tx.wBSNode.updateMany({
          data: {
            actualStart: null,
            actualFinish: null,
            projectedFinish: null,
            percentComplete: 0,
            // Back to truly "unstarted" so the dashboard rollup (which averages
            // over tracked leaves only) treats reset activities as not-started
            // rather than tracked-at-0%.
            progressEntered: false,
            delayReason: null,
          },
        })
      : { count: 0 };

    return {
      deleted: {
        inspections: insDel.count,
        inspectionItems: iiDel.count,
        inspectionPhotos: ipDel.count,
        concerns: cDel.count,
        concernPhotos: cpDel.count,
        hindrances: hDel.count,
        hindrancePhotos: hpDel.count,
        issues: issDel.count,
        issuePhotos: issPDel.count,
        progressEntries: pDel.count,
        progressLabour: plDel.count,
        progressPhotos: ppDel.count,
        rfis: rfiDel.count,
        permits: permitDel.count,
        manpowerEntries: manpowerDel.count,
        tradePlans: tradePlanDel.count,
        expenses: expenseDel.count,
        bills: billDel.count,
        projectDrawings: projectDrawingDel.count,
        designDrawings: designDrawingDel.count,
      },
      reset: { wbsNodes: wbsReset.count, requested: resetWbs },
    };
  }, { timeout: 60_000 });

  const after = await summarise();

  // Audit even though this endpoint doesn't scope by project — one row per
  // wipe, entityType "Project", entityId "*" is a coarse trail. If someone
  // ever asks "who wiped what and when" this is the only surviving evidence.
  await recordAudit({
    userId: session.user.id,
    action: "DELETE",
    entityType: "Project",
    entityId: "*",
    summary: "Cleared all test data (progress + hindrances + concerns + issues + inspections + photos)",
    changes: { deleted: result.deleted, reset: result.reset, before: before.wiping },
  });

  return NextResponse.json({ mode: "executed", before, result, after });
}
