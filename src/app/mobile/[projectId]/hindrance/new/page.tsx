import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, MODULES } from "@/lib/modules";
import ReportForm from "@/components/ReportForm";
import { HINDRANCE_REASONS } from "@/lib/hindranceReasons";

export default async function NewHindrancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  // Contractors scoped away from HINDRANCE shouldn't reach this form via
  // deep-linking. The API rejects the POST anyway, but rendering a big
  // WBS-loaded form for a user who can't submit is wasted work + confusing.
  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    redirect(`/mobile/${projectId}`);
  }
  return (
    <ReportForm
      projectId={projectId}
      title="New Hindrance"
      endpoint="/api/hindrances"
      successPath={`/mobile/${projectId}`}
      primaryButtonLabel="Report hindrance"
      scope="hindrance"
      extraFields={[
        { kind: "date",   key: "startDate",  label: "Started on", defaultToday: true },
        { kind: "number", key: "daysImpact", label: "Days impact (est.)", min: 0, placeholder: "0" },
        {
          kind: "select",
          key: "reasonCode",
          label: "Reason",
          default: "",
          options: [
            { value: "", label: "Select…" },
            ...HINDRANCE_REASONS.map((r) => ({ value: r.code, label: r.label })),
          ],
        },
        { kind: "text", key: "reasonNote", label: "Reason detail (optional)", placeholder: "e.g. cement not delivered" },
      ]}
    />
  );
}
