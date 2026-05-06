import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InsightsPanels from "@/components/InsightsPanels";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return null;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) notFound();

  return <InsightsPanels projectId={project.id} />;
}
