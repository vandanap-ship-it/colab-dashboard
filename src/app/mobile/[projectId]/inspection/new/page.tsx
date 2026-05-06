import InspectionForm from "@/components/InspectionForm";

export default async function NewInspectionPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <InspectionForm projectId={projectId} />;
}
