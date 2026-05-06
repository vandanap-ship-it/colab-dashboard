import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateProject } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import ImportSchedule from "@/components/ImportSchedule";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canCreateProject(session.user.role)) redirect("/");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        <ImportSchedule projectId={project.id} projectName={project.name} />
      </main>
    </div>
  );
}
