/**
 * Resume-editing a WIR draft. Loads the draft server-side, gates on
 * filler+module, and passes the state into <InspectionForm /> so the
 * form pre-fills every answer the filler had already made.
 *
 * Only DRAFT WIRs are editable this way. IN_REVIEW / PASSED / REJECTED /
 * RESCHEDULED WIRs redirect back to the QA/QC list — those states have
 * their own dedicated flows (Reopen for RESCHEDULED, a fresh WIR for
 * REJECTED, no edits on PASSED / IN_REVIEW).
 */
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, canAccessScopedRow, canAccessTool, MODULES, TOOL_MODULES } from "@/lib/modules";
import { isAdmin } from "@/lib/roles";
import InspectionForm from "@/components/InspectionForm";

export default async function EditDraftPage({
  params,
}: {
  params: Promise<{ projectId: string; draftId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, draftId } = await params;
  if (!canAccessTool(session.user.modules, TOOL_MODULES.inspection)) {
    redirect(`/mobile/${projectId}`);
  }
  if (
    !canAccessModule(session.user.modules, MODULES.QAQC) &&
    !canAccessModule(session.user.modules, MODULES.SAFETY)
  ) {
    redirect(`/mobile/${projectId}`);
  }

  const draft = await prisma.inspection.findFirst({
    where: { id: draftId, projectId, deletedAt: null },
    include: {
      items: { orderBy: { orderIndex: "asc" } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!draft) notFound();

  if (!canAccessScopedRow(session.user.modules, draft.module)) {
    redirect(`/mobile/${projectId}/qaqc`);
  }

  // Filler-only edit — admins have their own console path. Anyone else
  // trying to hand-craft this URL bounces back to the list, same shape
  // as the detail page's privacy gate.
  if (draft.filledById !== session.user.id && !isAdmin(session.user.role)) {
    redirect(`/mobile/${projectId}/qaqc`);
  }

  // A non-DRAFT WIR is not editable via this path. Redirect to its
  // detail page instead, where the correct affordances live.
  if (draft.status !== "DRAFT") {
    redirect(`/mobile/${projectId}/qaqc/${draft.id}`);
  }

  return (
    <InspectionForm
      projectId={projectId}
      editDraft={{
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt.toISOString(),
        title: draft.title,
        wbsNodeId: draft.wbsNodeId,
        submitRemark: draft.submitRemark,
        assignedReviewerIds: draft.assignedReviewerIds,
        items: draft.items.map((i) => ({
          label: i.label,
          passed: i.passed,
          notApplicable: i.notApplicable,
          notes: i.notes,
          photoUrl: i.photoUrl,
        })),
        photoUrls: draft.photos.map((p) => p.url),
      }}
    />
  );
}
