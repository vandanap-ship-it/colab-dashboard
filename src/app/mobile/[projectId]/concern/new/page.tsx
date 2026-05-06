import ReportForm from "@/components/ReportForm";

export default async function NewConcernPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
