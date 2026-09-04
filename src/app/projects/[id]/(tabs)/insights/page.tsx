import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import { getSmartInsights } from "@/lib/insightsServer";
import InsightsView from "@/components/InsightsView";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  // Insights is a planning-side view (delay heatmaps, hindrance rollups,
  // labour-vs-plan). The /api/projects/[id]/insights endpoint already
  // refuses scoped users; add the page-level gate so a non-SITE_ENGINEER
  // scoped user doesn't render the shell either.
  if (isScopedUser(session.user.modules)) redirect("/mobile");

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) notFound();

  const insights = await getSmartInsights(projectId).catch(() => []);

  return <InsightsView projectId={projectId} insights={insights} />;
}
