import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import InspectionForm from "@/components/InspectionForm";

export default async function NewInspectionDesktopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link
        href={`/projects/${projectId}/snapshot#qaqc`}
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Snapshot
      </Link>
      <h1 className="text-2xl font-semibold text-stone-900 mb-1">New Inspection</h1>
      <p className="text-sm text-stone-500 mb-6">
        Fill out a Work Inspection Request from desktop.
      </p>
      <InspectionForm projectId={projectId} redirectTo={`/projects/${projectId}/snapshot#qaqc`} />
    </div>
  );
}
