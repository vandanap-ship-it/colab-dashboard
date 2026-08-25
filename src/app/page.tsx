import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ProjectTable from "@/components/ProjectTable";
import { canCreateProject, canSeeDesktop, defaultLandingFor } from "@/lib/roles";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/");

  const role = session.user.role;
  if (!canSeeDesktop(role)) redirect(defaultLandingFor(role));

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      {/* Widen from max-w-6xl to full width — the projects table has 14
          columns and needs the extra room; horizontal scroll kicks in only
          on very narrow viewports. */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-6 py-10">
        <ProjectTable canCreate={canCreateProject(role)} />
      </main>
    </div>
  );
}
