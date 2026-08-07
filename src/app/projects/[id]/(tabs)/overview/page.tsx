import ExecutiveOverview from "@/components/executive/ExecutiveOverview";
import { PlaceholderBanner } from "@/components/executive/PlaceholderBanner";
import { UrlDetailDrawer } from "@/components/executive/DetailDrawer";
import VillaDetailContent from "@/components/executive/VillaDetailContent";
import BlockDetailContent from "@/components/executive/BlockDetailContent";
import { getDashboardBag } from "@/lib/rollupServer";
import { adaptDashboardBag } from "@/lib/executiveDataAdapter";
import { getBlockDetail, getVillaDetailByNumber } from "@/lib/detailServer";
import { getDelayReasonClusters } from "@/lib/delayReasons";
import {
  BLOCKS,
  CONTRACTORS,
  activeVillas,
  healthSummary,
} from "@/lib/executiveMockData";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vn?: string; bd?: string }>;
}) {
  const { id } = await params;
  const { vn, bd } = await searchParams;
  const villaNumber = vn ? parseInt(vn, 10) : null;
  const bag = await getDashboardBag(id);

  // Drawer detail data + delay-reason aggregation — fetched in parallel with
  // the main bag so opening a drawer costs at most one extra round-trip.
  const [villaDetail, blockDetail, reasonClusters] = await Promise.all([
    villaNumber && !isNaN(villaNumber)
      ? getVillaDetailByNumber(id, villaNumber).catch(() => null)
      : Promise.resolve(null),
    bd ? getBlockDetail(id, bd).catch(() => null) : Promise.resolve(null),
    getDelayReasonClusters(id).catch(() => []),
  ]);

  const overview = bag
    ? (() => {
        const adapted = adaptDashboardBag(bag);
        return (
          <ExecutiveOverview
            health={adapted.health}
            villas={adapted.villas}
            blocks={adapted.blocks}
            contractors={adapted.contractors}
            reasonClusters={reasonClusters}
          />
        );
      })()
    : (
      <>
        <PlaceholderBanner projectId={id} />
        <ExecutiveOverview
          health={healthSummary()}
          villas={activeVillas()}
          blocks={BLOCKS}
          contractors={CONTRACTORS}
          reasonClusters={reasonClusters}
        />
      </>
    );

  return (
    <>
      {overview}
      <UrlDetailDrawer
        param="vn"
        open={!!villaDetail}
        eyebrow="Villa · drill-down"
        title={villaDetail?.villaLabel ?? "Villa"}
        subtitle={villaDetail ? `Block ${villaDetail.blockCode} · ${villaDetail.projectName}` : undefined}
      >
        {villaDetail && <VillaDetailContent villa={villaDetail} />}
      </UrlDetailDrawer>
      <UrlDetailDrawer
        param="bd"
        open={!!blockDetail}
        eyebrow="Block · drill-down"
        title={blockDetail ? `Block ${blockDetail.code}` : "Block"}
        subtitle={blockDetail
          ? `${blockDetail.villaCount} villas · ${blockDetail.projectName}`
          : undefined}
      >
        {blockDetail && <BlockDetailContent block={blockDetail} />}
      </UrlDetailDrawer>
    </>
  );
}
