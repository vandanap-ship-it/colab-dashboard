import ReportForm from "@/components/ReportForm";

export default async function NewIssuePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
