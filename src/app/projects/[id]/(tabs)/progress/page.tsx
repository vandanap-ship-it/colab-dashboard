import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop, isAdmin, ROLES } from "@/lib/roles";
import {
  getSectionProgress,
  getVillaProgressRows,
  getInteractiveDrawingData,
  getProgressHeroStats,
} from "@/lib/progressTabServer";
import { getVillaDetailByNumber } from "@/lib/detailServer";
import ProgressTabView from "@/components/ProgressTabView";
import { UrlDetailDrawer } from "@/components/executive/DetailDrawer";
import VillaDetailContent from "@/components/executive/VillaDetailContent";

export const dynamic = "force-dynamic";

/**
 * Progress tab. Four sections stacked, all pulling from real data:
 *   §0 Overall picture - how far behind baseline we are TODAY
 *   §1 Planned vs Actual per milestone section
 *   §2 Villa-wise physical progress (sortable table)
 *   §3 Filter by Section (status + per-status villa chips)
 *
 * (The interactive master-plan drawing was removed 2026-11-04 - Vandana
 * management-review pass. The section filter stays.)
 *
 * Villa links in §2 and §3 open the villa drill-down drawer INLINE on this
 * page via ?vn=NN (Vandana 2026-11-04 management-review pass). Previously
 * they redirected back to the Dashboard tab - that bounce confused people
 * walking through the Progress tab in a review.
 */
export default async function ProgressTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vn?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;
  const { vn } = await searchParams;
  const villaNumber = vn ? parseInt(vn, 10) : null;
  // Kept for future "edit master plan" entry points; the inline uploader
  // was removed with the interactive drawing.
  void (
    isAdmin(session.user.role) ||
    session.user.role === ROLES.PLANNER ||
    session.user.role === ROLES.PRODUCT_TEAM
  );

  const [hero, sectionProgress, villaRows, drawingData, villaDetail] = await Promise.all([
    getProgressHeroStats(projectId).catch(() => ({
      dueByToday: 0,
      closedByToday: 0,
      openPastDue: 0,
      meanDaysBehind: 0,
      maxDaysBehind: 0,
    })),
    getSectionProgress(projectId).catch(() => []),
    getVillaProgressRows(projectId).catch(() => []),
    getInteractiveDrawingData(projectId).catch(() => ({
      masterPlanUrl: null,
      sections: [],
      villas: [],
    })),
    villaNumber && !isNaN(villaNumber)
      ? getVillaDetailByNumber(projectId, villaNumber).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <ProgressTabView
        projectId={projectId}
        hero={hero}
        sectionProgress={sectionProgress}
        villaRows={villaRows}
        drawingData={drawingData}
      />
      <UrlDetailDrawer
        param="vn"
        open={!!villaDetail}
        eyebrow="Villa · drill-down"
        title={villaDetail?.villaLabel ?? "Villa"}
        subtitle={villaDetail ? `Block ${villaDetail.blockCode} · ${villaDetail.projectName}` : undefined}
      >
        {villaDetail && <VillaDetailContent villa={villaDetail} />}
      </UrlDetailDrawer>
    </>
  );
}
