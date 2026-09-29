import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
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
  searchParams: Promise<{ wbsNodeId?: string; templateId?: string; villaId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessTool(session.user.modules, TOOL_MODULES.inspection)) {
    redirect(`/mobile/${projectId}`);
  }
  const { wbsNodeId, templateId } = await searchParams;

  // No template picked yet → show the picker.
  if (!templateId) {
    return <WIRTemplatePickerScreen projectId={projectId} wbsNodeId={wbsNodeId ?? null} />;
  }

  // Template picked → render the form with it applied.
  return (
    <InspectionForm
      projectId={projectId}
      initialWbsNodeId={wbsNodeId ?? null}
      initialTemplateId={templateId}
    />
  );
}
