import SiteProgressList from "@/components/SiteProgressList";

export default async function SiteProgressPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SiteProgressList projectId={projectId} />;
}
