import ReportForm from "@/components/ReportForm";
import { HINDRANCE_REASONS } from "@/lib/hindranceReasons";

export default async function NewHindrancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
