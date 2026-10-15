import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import InspectionForm from "@/components/InspectionForm";
import WIRTemplatePickerScreen from "@/components/WIRTemplatePickerScreen";

/**
 * Raise a fresh WIR.
 *
 * Colab-parity flow: the filler taps "Inspection Checklist" from the
 * home FAB / My Tools tile, and this page first shows the template
 * picker ("Add Checklist" screen — Manual + Activity tabs with cards
 * for each template). Tapping a card's "Add Checklist" navigates back
 * here with `?templateId=…` set, and this page then renders the
 * inspection form with that template already applied.
 *
 * Other query params:
 * - `wbsNodeId` — deep-link into an activity (from the Log Progress
 *   precheck callout). Same as before.
 * - `villaId` — pre-selects villa on the form's location cascade.
 */
export default async function NewInspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    wbsNodeId?: string;
    templateId?: string;
    villaId?: string;
    // Colab-parity 2026-10-13: the template picker's "Add Checklist"
    // tap opens a Select Location + Activity Head bottom sheet
    // first; its Save navigates here with villaId + activityHead so
    // the form opens with location already picked.
    activityHead?: string;
    // Colab 2026-10-01 parity: Safety raises an HSE Inspection
    // Checklist through this same URL with ?module=SAFETY. The
    // picker then shows only safety templates. QAQC users land here
    // via Raise WIR with no module hint, defaulting to QAQC.
    module?: string;
    // Register deep link — pre-picks the item (e.g. one fire
    // extinguisher) the checklist is for.
    registerRowId?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessTool(session.user.modules, TOOL_MODULES.inspection)) {
    redirect(`/mobile/${projectId}`);
  }
  const {
    wbsNodeId,
    templateId,
    villaId,
    activityHead,
    module: moduleHint,
    registerRowId,
  } = await searchParams;
  const scoped = moduleHint === "SAFETY" || moduleHint === "QAQC" ? moduleHint : null;

  // No template picked yet → show the picker.
  if (!templateId) {
    return (
      <WIRTemplatePickerScreen
        projectId={projectId}
        wbsNodeId={wbsNodeId ?? null}
        moduleHint={scoped}
      />
    );
  }

  // HSE Checklist approver routing (Vandana 2026-10-15):
  //   - Elegant's safety team (raiser.contractorId = Elegant) → their
  //     own safety approver (Asif today).
  //   - Any other contractor-scoped raiser whose contractor has its
  //     own tagged safety approver → that approver.
  //   - Everyone else (White Lotus staff, contractors without a
  //     dedicated safety approver) → the unscoped head of safety
  //     (Girish R today).
  //
  // We resolve this server-side so a single DB row (an in-house
  // promotion, a contractor hire, a safety approver stepping away)
  // reroutes the whole flow — no code change. The resolution runs on
  // every template-picked page load because the raiser's own
  // contractor can't change mid-session but the approver roster can,
  // and the fetch is a single indexed row.
  const safetyApproverModuleFilter = {
    OR: [
      { modules: null },
      { modules: { contains: "SAFETY" } },
    ],
  };
  let hseApprover: { id: string; name: string } | null = null;
  if (session.user.contractorId) {
    hseApprover = await prisma.user.findFirst({
      where: {
        active: true,
        canApproveWorkPermits: true,
        contractorId: session.user.contractorId,
        ...safetyApproverModuleFilter,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }
  if (!hseApprover) {
    hseApprover = await prisma.user.findFirst({
      where: {
        active: true,
        canApproveWorkPermits: true,
        contractorId: null,
        ...safetyApproverModuleFilter,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  // Template picked → render the form with it applied.
  return (
    <InspectionForm
      projectId={projectId}
      initialWbsNodeId={wbsNodeId ?? null}
      initialTemplateId={templateId}
      initialRegisterRowId={registerRowId ?? null}
      initialVillaId={villaId ?? null}
      initialActivityHead={activityHead ?? null}
      hseApprover={hseApprover}
    />
  );
}
