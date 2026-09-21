import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import MobileSearchClient from "@/components/mobile/MobileSearchClient";

export const dynamic = "force-dynamic";

export default async function MobileSearchPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  return <MobileSearchClient projectId={projectId} />;
}
