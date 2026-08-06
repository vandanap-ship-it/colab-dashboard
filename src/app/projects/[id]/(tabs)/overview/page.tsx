import ExecutiveOverview from "@/components/executive/ExecutiveOverview";
import { PlaceholderBanner } from "@/components/executive/PlaceholderBanner";
import { getDashboardBag } from "@/lib/rollupServer";
import { adaptDashboardBag } from "@/lib/executiveDataAdapter";
import {
  BLOCKS,
  CONTRACTORS,
  activeVillas,
  healthSummary,
} from "@/lib/executiveMockData";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bag = await getDashboardBag(id);

  if (bag) {
    const adapted = adaptDashboardBag(bag);
    return (
      <ExecutiveOverview
        health={adapted.health}
        villas={adapted.villas}
        blocks={adapted.blocks}
        contractors={adapted.contractors}
      />
    );
  }

  // Transitional fallback: no MSP imported yet → render with placeholder mock
  // data + a banner so the page is legible while data plumbing catches up.
  return (
    <>
      <PlaceholderBanner projectId={id} />
      <ExecutiveOverview
        health={healthSummary()}
        villas={activeVillas()}
        blocks={BLOCKS}
        contractors={CONTRACTORS}
      />
    </>
  );
}
