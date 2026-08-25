import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin, ROLES } from "@/lib/roles";
import {
  getSectionProgress,
  getVillaProgressRows,
  getInteractiveDrawingData,
} from "@/lib/progressTabServer";
import ProgressTabView from "@/components/ProgressTabView";

export const dynamic = "force-dynamic";

/**
 * Progress tab. Three sections stacked, all pulling from real data:
 *   §1 Planned vs Actual per milestone section
 *   §2 Villa-wise physical progress (sortable table)
 *   §3 Interactive Drawing — master plan image + section filter
 */
export default async function ProgressTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;

  const canEditMasterPlan =
    isAdmin(session.user.role) ||
    session.user.role === ROLES.PLANNER ||
    session.user.role === ROLES.PRODUCT_TEAM;

  const [sectionProgress, villaRows, drawingData] = await Promise.all([
    getSectionProgress(projectId).catch(() => []),
    getVillaProgressRows(projectId).catch(() => []),
    getInteractiveDrawingData(projectId).catch(() => ({
      masterPlanUrl: null,
      sections: [],
      villas: [],
    })),
  ]);

  return (
    <ProgressTabView
      projectId={projectId}
      canEditMasterPlan={canEditMasterPlan}
      sectionProgress={sectionProgress}
      villaRows={villaRows}
      drawingData={drawingData}
    />
  );
}
