import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import ReportForm from "@/components/ReportForm";

export default async function NewConcernPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessModule(session.user.modules, MODULES.CONCERN)) {
    redirect(`/mobile/${projectId}`);
  }
  return (
    <ReportForm
      projectId={projectId}
      title="Areas of Concern"
      endpoint="/api/concerns"
      successPath={`/mobile/${projectId}`}
      primaryButtonLabel="Raise concern"
      scope="concern"
    />
  );
}
