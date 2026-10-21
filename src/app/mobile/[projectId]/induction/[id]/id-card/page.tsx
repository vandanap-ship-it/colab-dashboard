import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import InductionIdCard from "@/components/InductionIdCard";

export const dynamic = "force-dynamic";

/**
 * Printable Safety Induction ID card. Vandana 2026-10-21:
 *
 *   • Only renders for APPROVED inductions (an induction isn't
 *     complete until Girish / Asif signs off; a card for a PENDING
 *     worker would be a mis-statement of "this person has done
 *     safety induction").
 *   • Open to any user with SAFETY module access, matching the
 *     existing induction detail-page gate. The site team should be
 *     able to print cards without going through an admin.
 *   • Full Aadhaar is masked on the printed card (XXXX XXXX 1234).
 *     Siddhi keeps the full number; the card doesn't become a
 *     secondary ID document for a lost worker.
 */
export default async function InductionIdCardPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${projectId}`);
  }

  const induction = await prisma.safetyInduction.findUnique({
    where: { id },
    include: {
      contractor: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!induction || induction.deletedAt) notFound();
  if (induction.status !== "APPROVED") {
    // Can't print a card for a worker whose induction isn't signed off.
    // Bounce back to the detail page where the reviewer can approve
    // first; nothing on the ID-card page would be meaningful otherwise.
    redirect(`/mobile/${projectId}/induction/${id}`);
  }

  return (
    <InductionIdCard
      projectId={projectId}
      projectName={induction.project.name}
      induction={{
        id: induction.id,
        displayId: induction.displayId,
        workerName: induction.workerName,
        workerPhotoUrl: induction.workerPhotoUrl,
        trade: induction.trade,
        contractorName: induction.contractor?.name ?? null,
        gender: induction.gender,
        age: induction.age,
        dob: induction.dob ? induction.dob.toISOString() : null,
        contactNumber: induction.contactNumber,
        aadhaarNumber: induction.aadhaarNumber,
        signatureUrl: induction.signatureUrl,
        inductionDate: induction.inductionDate.toISOString(),
        expiryDate: induction.expiryDate.toISOString(),
      }}
    />
  );
}
