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
      howThisWorks={{
        title: "How to raise a concern",
        storageKey: "siddhi.htw.concern",
        steps: [
          "Pick the activity the concern is about (search by block, villa, or activity name).",
          "Describe what you noticed — a leak forming, a wonky finish, a safety near-miss, anything that needs a second pair of eyes.",
          "Add 1 or 2 photos so leadership can see what you saw.",
          "Tap Raise concern. It goes into the concerns queue for someone to review.",
        ],
      }}
    />
  );
}
