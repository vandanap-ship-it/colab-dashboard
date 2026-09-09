import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import NewProgressForm from "@/components/NewProgressForm";

export default async function NewProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ wbsId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  const { wbsId } = await searchParams;
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    redirect(`/mobile/${projectId}`);
  }
  return <NewProgressForm projectId={projectId} initialActivityId={wbsId} />;
}
