import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import ReportForm from "@/components/ReportForm";

export default async function NewIssuePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  // Snags = QA/QC or Safety scope (either can raise). Contractors scoped
  // to PERMIT only shouldn't reach this form via deep-link.
  if (!canAccessTool(session.user.modules, TOOL_MODULES.snag)) {
    redirect(`/mobile/${projectId}`);
  }
  return (
    <ReportForm
      projectId={projectId}
      title="New Snag"
      endpoint="/api/issues"
      successPath={`/mobile/${projectId}`}
      primaryButtonLabel="Report snag"
      scope="issue"
      extraFields={[
        {
          kind: "select",
          key: "severity",
          label: "Severity",
          options: [
            { value: "LOW", label: "Low" },
            { value: "MEDIUM", label: "Medium" },
            { value: "HIGH", label: "High" },
          ],
          default: "MEDIUM",
        },
        {
          kind: "text",
          key: "category",
          label: "Defect category",
          placeholder: "e.g. Not in plumb",
        },
      ]}
    />
  );
}
