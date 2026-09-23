import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import MobileHindranceForm from "@/components/mobile/MobileHindranceForm";

export default async function NewHindrancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  // Contractors scoped away from HINDRANCE shouldn't reach this form via
  // deep-linking. The API rejects the POST anyway, but rendering a big
  // WBS-loaded form for a user who can't submit is wasted work + confusing.
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    redirect(`/mobile/${projectId}`);
  }
  return <MobileHindranceForm projectId={projectId} />;
}
