import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ProjectList from "@/components/ProjectList";
import { canCreateProject, canSeeDesktop, defaultLandingFor } from "@/lib/roles";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/");

  const role = session.user.role;
  if (!canSeeDesktop(role)) redirect(defaultLandingFor(role));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-10">
        <ProjectList canCreate={canCreateProject(role)} />
      </main>
    </div>
  );
}
