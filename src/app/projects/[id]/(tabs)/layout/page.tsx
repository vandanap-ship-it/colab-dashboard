import ExecutiveLayout from "@/components/executive/ExecutiveLayout";
import { PlaceholderBanner } from "@/components/executive/PlaceholderBanner";
import { getDashboardBag } from "@/lib/rollupServer";
import { adaptDashboardBag } from "@/lib/executiveDataAdapter";
import { BLOCKS, SECTIONS, VILLA_SLIPS } from "@/lib/executiveMockData";

export const dynamic = "force-dynamic";

export default async function LayoutTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bag = await getDashboardBag(id);

  if (bag) {
    const adapted = adaptDashboardBag(bag);
    // Derive per-active-villa slip/section map from the real rollup.
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
  }

  // Fallback: strip the mock VILLA_SLIPS shape down to what the component takes.
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
}
