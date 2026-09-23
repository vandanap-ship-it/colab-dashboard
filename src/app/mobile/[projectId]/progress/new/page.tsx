import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import NewProgressForm from "@/components/NewProgressForm";

export default async function NewProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  /** wbsId: deep-link into an activity (e.g. from the WIR precheck callout).
   *  draftId: resume a saved draft — the form fetches it on mount and
   *  pre-fills every field, with Publish + Discard buttons in place of
   *  the normal Save flow. */
  searchParams: Promise<{ wbsId?: string; draftId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  const { wbsId, draftId } = await searchParams;
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    redirect(`/mobile/${projectId}`);
  }
  return (
    <NewProgressForm
      projectId={projectId}
      initialActivityId={wbsId}
      resumeDraftId={draftId}
    />
  );
}
