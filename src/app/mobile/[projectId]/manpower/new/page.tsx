import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import ManpowerEntryForm, { type ContractorOption } from "@/components/ManpowerEntryForm";
import { TRADES } from "@/lib/manpower";

export const dynamic = "force-dynamic";

export default async function NewManpowerPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    redirect(`/mobile/${(await params).projectId}`);
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const contractors = await prisma.contractor.findMany({
    where: { projectId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true },
  });

  const contractorOptions: ContractorOption[] = contractors.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
  }));

  return (
    <ManpowerEntryForm
      projectId={projectId}
      projectName={project.name}
      contractors={contractorOptions}
      trades={[...TRADES]}
    />
  );
}
