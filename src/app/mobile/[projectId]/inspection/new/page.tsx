import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import InspectionForm from "@/components/InspectionForm";

export default async function NewInspectionPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessTool(session.user.modules, TOOL_MODULES.inspection)) {
    redirect(`/mobile/${projectId}`);
  }
  return <InspectionForm projectId={projectId} />;
}
