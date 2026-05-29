import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import MobileExpenseForm from "@/components/MobileExpenseForm";

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  // Same gate as the mobile home tile: internal site staff only.
  if (!canAccessTool(session.user.modules, TOOL_MODULES.expense)) {
    redirect(`/mobile/${projectId}`);
  }
  return <MobileExpenseForm projectId={projectId} />;
}
