import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES, hasFullAccess } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import WorkPermitForm from "@/components/WorkPermitForm";

export const dynamic = "force-dynamic";

/**
 * Mobile page for a Site Engineer / HSE Officer / Safety Officer to raise a
 * new work permit for the day. Approvers are internal-only staff — a scoped
 * contractor cannot end up in the approver picker.
 */
export default async function NewWorkPermitPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${(await params).projectId}`);
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Approvers = active internal-staff users tagged with
  // canApproveWorkPermits=true. Was "every internal user" (`modules: null`)
  // pre-Sep 17 — Shraddha asked for the picker to only show the site
  // manager(s) actually authorised to approve. Admin > Users toggles the
  // flag; the API's approve/reject gate still guards the server-side
  // decision independently, so this is a UX narrowing rather than a
  // security boundary.
  const users = await prisma.user.findMany({
    where: {
      active: true,
      modules: null,
      canApproveWorkPermits: true,
    },
    select: { id: true, name: true, username: true, role: true },
    orderBy: { name: "asc" },
  });

  // Contractors on the project (for the optional contractor picker).
  const contractors = await prisma.contractor.findMany({
    where: { projectId, active: true },
    select: { id: true, name: true, category: true },
    orderBy: { name: "asc" },
  });

  return (
    <WorkPermitForm
      projectId={projectId}
      projectName={project.name}
      currentUserId={session.user.id}
      approverCandidates={users}
      contractors={contractors}
      // Scoped users can raise (per the API gate) but cannot appear in the
      // approver picker. Requesters and approvers are the same list here
      // — the form filters out the current user from the approver picker
      // so nobody self-approves.
      isFullAccess={hasFullAccess(session.user.modules)}
    />
  );
}
