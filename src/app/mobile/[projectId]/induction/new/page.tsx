import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import InductionForm from "@/components/InductionForm";

export const dynamic = "force-dynamic";

/**
 * Raise a Safety Induction. Form is a client component (photo capture +
 * step-by-step validation); this server page handles auth, module
 * access, and the contractor list the form picker shows.
 */
export default async function NewInductionPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${projectId}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const contractors = await prisma.contractor.findMany({
    where: { projectId, active: true },
    select: { id: true, name: true, category: true },
    orderBy: { name: "asc" },
  });

  return (
    <InductionForm
      projectId={projectId}
      projectName={project.name}
      contractors={contractors}
    />
  );
}
