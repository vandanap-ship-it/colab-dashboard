import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import MobileRfiForm from "@/components/mobile/MobileRfiForm";

export const dynamic = "force-dynamic";

export default async function MobileRfiNewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/mobile/${projectId}`);
  }
  return <MobileRfiForm projectId={projectId} />;
}
