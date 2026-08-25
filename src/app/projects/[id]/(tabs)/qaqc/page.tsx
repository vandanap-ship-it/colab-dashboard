import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { canAccessModule, MODULES } from "@/lib/modules";
import { getQaqcBundle } from "@/lib/qaqcServer";
import QaqcTabView from "@/components/QaqcTabView";

export const dynamic = "force-dynamic";

export default async function QaqcTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;

  if (!canAccessModule(session.user.modules, MODULES.QAQC)) {
    redirect(`/projects/${projectId}/overview`);
  }

  const bundle = await getQaqcBundle(projectId).catch(() => null);
  if (!bundle) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Couldn&apos;t load QA/QC data.
      </div>
    );
  }

  return <QaqcTabView projectId={projectId} bundle={bundle} />;
}
