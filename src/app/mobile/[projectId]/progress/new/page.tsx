import NewProgressForm from "@/components/NewProgressForm";

export default async function NewProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ wbsId?: string }>;
}) {
  const { projectId } = await params;
  const { wbsId } = await searchParams;
  return <NewProgressForm projectId={projectId} initialActivityId={wbsId} />;
}
