import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getSmartInsights } from "@/lib/insightsServer";
import InsightsView from "@/components/InsightsView";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) notFound();

  const insights = await getSmartInsights(projectId).catch(() => []);

  return <InsightsView projectId={projectId} insights={insights} />;
}
