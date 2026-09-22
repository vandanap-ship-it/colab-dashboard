import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import InspectionForm from "@/components/InspectionForm";

/**
 * Raise a fresh WIR.
 *
 * Accepts an optional `?wbsNodeId=…` query param — used by the Log
 * Progress precheck callout to deep-link into "raise the WIR for the
 * prerequisite" with the required activity already picked. Any other
 * caller (the FAB, the home tile) reaches this page with no query and
 * the form opens fresh.
 */
export default async function NewInspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ wbsNodeId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessTool(session.user.modules, TOOL_MODULES.inspection)) {
    redirect(`/mobile/${projectId}`);
  }
  const { wbsNodeId } = await searchParams;
  return <InspectionForm projectId={projectId} initialWbsNodeId={wbsNodeId ?? null} />;
}
