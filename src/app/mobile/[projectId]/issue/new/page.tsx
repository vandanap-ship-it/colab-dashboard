import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTool, TOOL_MODULES } from "@/lib/modules";
import ReportForm from "@/components/ReportForm";

export default async function NewIssuePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  // Snags = QA/QC or Safety scope (either can raise). Contractors scoped
  // to PERMIT only shouldn't reach this form via deep-link.
  if (!canAccessTool(session.user.modules, TOOL_MODULES.snag)) {
    redirect(`/mobile/${projectId}`);
  }
  return (
    <ReportForm
      projectId={projectId}
      title="Observations"
      endpoint="/api/issues"
      successPath={`/mobile/${projectId}`}
      primaryButtonLabel="Save"
      scope="issue"
      howThisWorks={{
        title: "How to raise an observation",
        storageKey: "siddhi.htw.snag",
        steps: [
          "Pick a category — Quality, Safety, or Workmanship — so the right reviewers see it.",
          "Pick the activity the observation belongs to (search by block, villa, or activity name).",
          "Describe what you saw — the defect, where exactly on the villa, a measurement if it helps.",
          "Add 1 or 2 photos of the actual defect. The assignee needs to see it.",
          "Set the severity — Minor, Major, or Critical.",
          "Optional: pick a contractor to debit + the amount if there's cost recovery.",
          "Set a due date so the assignee knows when it's expected to close.",
          "Tap Save. The contractor gets pinged and can respond.",
        ],
      }}
      extraFields={[
        // Colab-parity: Category radio (Quality / Safety / Workmanship).
        {
          kind: "select",
          key: "category",
          label: "Category",
          options: [
            { value: "Quality", label: "Quality" },
            { value: "Safety", label: "Safety" },
            { value: "Workmanship", label: "Workmanship" },
          ],
          default: "Quality",
        },
        // Colab-parity: Severity vocab Minor / Major / Critical.
        {
          kind: "select",
          key: "severity",
          label: "Severity",
          options: [
            { value: "Minor", label: "Minor" },
            { value: "Major", label: "Major" },
            { value: "Critical", label: "Critical" },
          ],
          default: "Minor",
        },
        // Colab-parity: Debit Amount (₹). Debit-to contractor picker is a
        // dynamic option list — deferred to a follow-up because ReportForm
        // doesn't yet accept fetched select options. Setting only the
        // amount is still useful for downstream reporting; the contractor
        // can be filled in when the issue is triaged.
        {
          kind: "number",
          key: "debitAmount",
          label: "Debit Amount (₹)",
          min: 0,
          placeholder: "Enter amount",
        },
        // Colab-parity: Due Date, defaults to today.
        {
          kind: "date",
          key: "dueDate",
          label: "Due Date",
          defaultToday: true,
        },
      ]}
    />
  );
}
