import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import { canAccessModule, MODULES, type ModuleKey } from "@/lib/modules";
import { getSafetyBundle } from "@/lib/safetyServer";
import SafetyTabView, { type RegisterSummary } from "@/components/SafetyTabView";
import { istDayString } from "@/lib/istDay";
import { formatDayMonthYear } from "@/lib/dates";
import { dueState } from "@/lib/registers";
import { listRegisterTypes, loadRegisterOverview } from "@/lib/registersServer";

export const dynamic = "force-dynamic";

export default async function SafetyTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  const { id: projectId } = await params;

  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/projects/${projectId}/overview`);
  }

  const bundle = await getSafetyBundle(projectId).catch(() => null);
  if (!bundle) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Couldn&apos;t load safety data.
      </div>
    );
  }

  const registers = await loadRegisterSummaries(projectId, session.user.modules).catch(() => []);

  return <SafetyTabView projectId={projectId} bundle={bundle} registers={registers} />;
}

async function loadRegisterSummaries(projectId: string, modules: string | null | undefined): Promise<RegisterSummary[]> {
  const todayIso = istDayString();
  const types = (await listRegisterTypes()).filter((t) => canAccessModule(modules, t.module as ModuleKey));
  return Promise.all(
    types.map(async (t) => {
      const o = await loadRegisterOverview(projectId, t);
      const live = o.rows.filter((r) => !r.retiredAt);
      const states = t.dueDateKey ? live.map((r) => dueState(r.values[t.dueDateKey!], todayIso)) : [];
      return {
        code: t.code,
        name: t.name,
        live: live.length,
        overdue: states.filter((s) => s === "overdue").length,
        dueSoon: states.filter((s) => s === "due_soon").length,
        pendingDisplayId: o.pending?.displayId ?? null,
        lastSignedOff: o.lastApproved ? formatDayMonthYear(o.lastApproved.approvedAt) : null,
      };
    }),
  );
}
