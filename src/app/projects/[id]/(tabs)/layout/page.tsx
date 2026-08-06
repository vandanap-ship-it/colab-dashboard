import ExecutiveLayout from "@/components/executive/ExecutiveLayout";
import { PlaceholderBanner } from "@/components/executive/PlaceholderBanner";
import { UrlDetailDrawer } from "@/components/executive/DetailDrawer";
import VillaDetailContent from "@/components/executive/VillaDetailContent";
import BlockDetailContent from "@/components/executive/BlockDetailContent";
import { getDashboardBag } from "@/lib/rollupServer";
import { adaptDashboardBag } from "@/lib/executiveDataAdapter";
import { getBlockDetail, getVillaDetailByNumber } from "@/lib/detailServer";
import { BLOCKS, SECTIONS, VILLA_SLIPS } from "@/lib/executiveMockData";

export const dynamic = "force-dynamic";

export default async function LayoutTabPage({
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

  const [villaDetail, blockDetail] = await Promise.all([
    villaNumber && !isNaN(villaNumber)
      ? getVillaDetailByNumber(id, villaNumber).catch(() => null)
      : Promise.resolve(null),
    bd ? getBlockDetail(id, bd).catch(() => null) : Promise.resolve(null),
  ]);

  const layout = bag
    ? (() => {
        const adapted = adaptDashboardBag(bag);
        const villaSlips: Record<number, { slip: number; section: number }> = {};
        for (const v of adapted.villas) {
          villaSlips[v.number] = { slip: v.slipDays, section: v.currentSection };
        }
        return (
          <ExecutiveLayout
            blocks={adapted.blocks}
            sections={adapted.sections}
            villaSlips={villaSlips}
          />
        );
      })()
    : (() => {
        const mockVillaSlips: Record<number, { slip: number; section: number }> = {};
        for (const [n, v] of Object.entries(VILLA_SLIPS)) {
          mockVillaSlips[Number(n)] = { slip: v.slip, section: v.section };
        }
        return (
          <>
            <PlaceholderBanner projectId={id} />
            <ExecutiveLayout
              blocks={BLOCKS}
              sections={SECTIONS}
              villaSlips={mockVillaSlips}
            />
          </>
        );
      })();

  return (
    <>
      {layout}
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
