import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ProjectTable from "@/components/ProjectTable";
import { canCreateProject, canSeeDesktop, canSeeMobile, defaultLandingFor } from "@/lib/roles";
import { isPhoneRequest, hasDesktopPreference } from "@/lib/device";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ ui?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/");

  const role = session.user.role;
  if (!canSeeDesktop(role)) redirect(defaultLandingFor(role));

  // Phone-shaped device with a desktop role → route to the mobile project
  // switcher instead of rendering the 14-column desktop table into a
  // 375px viewport. Planners on their laptops keep the desktop table.
  // Escape hatch: `?ui=desktop` in the URL or a sticky cookie.
  const sp = (await searchParams) ?? {};
  const wantsDesktop = await hasDesktopPreference(sp);
  if (!wantsDesktop && canSeeMobile(role) && (await isPhoneRequest())) {
    redirect("/mobile");
  }

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      {/* Widen from max-w-6xl to full width — the projects table has 14
          columns and needs the extra room; horizontal scroll kicks in only
          on very narrow viewports. */}
      <main className="flex-1 w-full max-w-[1800px] mx-auto px-8 py-10">
        <ProjectTable canCreate={canCreateProject(role)} />
      </main>
    </div>
  );
}
