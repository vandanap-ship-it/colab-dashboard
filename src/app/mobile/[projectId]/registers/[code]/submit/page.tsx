import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { istDayString } from "@/lib/istDay";
import { dueState } from "@/lib/registers";
import { getRegisterType, loadRegisterOverview } from "@/lib/registersServer";
import RegisterTable from "@/components/registers/RegisterTable";
import RegisterSubmitForm from "@/components/registers/RegisterSubmitForm";

export const dynamic = "force-dynamic";

/**
 * Submit for sign-off — the maker reviews the live list in the Excel
 * layout, sets the sheet date, adds a note and submits. The API freezes
 * exactly these rows into the sign-off.
 */
export default async function SubmitRegisterPage({
  params,
}: {
  params: Promise<{ projectId: string; code: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId, code } = await params;
  const type = await getRegisterType(code);
  if (!type) notFound();
  if (!canAccessModule(session.user.modules, type.module as ModuleKey)) redirect(`/mobile/${projectId}`);

  const overview = await loadRegisterOverview(projectId, type);
  const back = `/mobile/${projectId}/registers/${code}`;
  if (overview.pending) redirect(`${back}/submissions/${overview.pending.id}`);

  const todayIso = istDayString();
  const live = overview.rows.filter((r) => !r.retiredAt);
  const overdueCount = type.dueDateKey
    ? live.filter((r) => dueState(r.values[type.dueDateKey!], todayIso) === "overdue").length
    : 0;

  return (
    <div className="px-4 py-5 space-y-4">
      <header>
        <h1 className="font-serif text-[26px] leading-tight text-ink tracking-tight">Submit for sign-off</h1>
        <p className="text-[13px] text-ink-3 mt-1">
          {type.name} · {live.length} item{live.length === 1 ? "" : "s"}. Check every row — this is what gets signed
          and printed.
        </p>
      </header>

      {canReview(session.user.role) && (
        <p className="rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-900 text-[12px] p-2.5">
          You sign off this register, and nobody can approve their own submission. Usually the safety officer
          submits it and you approve.
        </p>
      )}

      {live.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-500">
          Nothing on the list yet.{" "}
          <Link href={back} className="text-ferrous-600 font-semibold">
            Add items first
          </Link>
          .
        </div>
      ) : (
        <>
          <RegisterTable columns={type.columns} identifierKey={type.identifierKey} rows={live} dueDateKey={type.dueDateKey} todayIso={todayIso} />
          <p className="text-[12px] text-stone-500">
            Something wrong?{" "}
            <Link href={back} className="text-ferrous-600 font-semibold">
              Go back and edit
            </Link>{" "}
            before submitting.
          </p>
          <RegisterSubmitForm projectId={projectId} typeCode={code} todayIso={todayIso} overdueCount={overdueCount} />
        </>
      )}
    </div>
  );
}
