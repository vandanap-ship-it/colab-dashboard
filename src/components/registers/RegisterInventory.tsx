"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Clock, FireExtinguisher, Plus, Search, Send } from "lucide-react";
import { dueLabel, dueState, type DueState } from "@/lib/registers";
import RegisterRowSheet, { type SheetConfig, type SheetRow } from "./RegisterRowSheet";

export type InventoryFilter = "all" | "due_soon" | "overdue" | "retired";
const FILTERS: InventoryFilter[] = ["all", "due_soon", "overdue", "retired"];
const FILTER_LABELS: Record<InventoryFilter, string> = {
  all: "All",
  due_soon: "Due soon",
  overdue: "Overdue",
  retired: "Retired",
};

/**
 * The live register on the phone: summary, filter chips, search, one card
 * per item, tap to edit in a bottom sheet, + to add. The sticky footer
 * either starts a sign-off or points at the one already waiting.
 */
export default function RegisterInventory({
  config,
  rows,
  initialFilter,
  pendingSubmission,
  lastApproved,
  signOffDue,
  title,
  tabs,
}: {
  title: string;
  /** Inventory | Sign-offs tab strip, rendered by the server page. */
  tabs: React.ReactNode;
  config: SheetConfig;
  rows: SheetRow[];
  initialFilter: InventoryFilter;
  pendingSubmission: { id: string; displayId: string } | null;
  lastApproved: { displayId: string; approvedOn: string } | null;
  signOffDue: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<InventoryFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ row: SheetRow | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { dueDateKey, todayIso } = config;
  const stateOf = (r: SheetRow): DueState =>
    dueDateKey ? dueState(r.values[dueDateKey], todayIso) : "none";

  const live = useMemo(() => rows.filter((r) => !r.retiredAt), [rows]);
  const counts = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    for (const r of live) {
      const s = dueDateKey ? dueState(r.values[dueDateKey], todayIso) : "none";
      if (s === "overdue") overdue++;
      else if (s === "due_soon") dueSoon++;
    }
    return { all: live.length, overdue, due_soon: dueSoon, retired: rows.length - live.length };
  }, [rows, live, dueDateKey, todayIso]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "retired" ? !r.retiredAt : r.retiredAt) return false;
      if (filter === "overdue" && stateOf(r) !== "overdue") return false;
      if (filter === "due_soon" && stateOf(r) !== "due_soon") return false;
      if (!q) return true;
      const hay = [r.identifier, ...Object.values(r.values), r.villaLabel ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
    // stateOf is derived from dueDateKey + todayIso, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, query, dueDateKey, todayIso]);

  function pickFilter(f: InventoryFilter) {
    setFilter(f);
    // Keep the URL shareable (push deep links use ?filter=) without a reload.
    const url = new URL(window.location.href);
    if (f === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", f);
    window.history.replaceState(null, "", url.toString());
  }

  function onSaved(message: string) {
    setSheet(null);
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
    startTransition(() => router.refresh());
  }

  const locationKey = config.columns.find((c) => c.key === "location")?.key;
  const typeKey = config.columns.find((c) => c.kind === "select")?.key;

  return (
    <>
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight">{title}</h1>
          <button
            type="button"
            onClick={() => setSheet({ row: null })}
            className="inline-flex items-center gap-1 rounded-full bg-ink text-cream text-[12px] font-semibold px-3 py-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
        {tabs}
      </div>

      {/* Summary */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="On site" value={counts.all} />
          <Stat label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? "red" : undefined} />
          <Stat label="Due in 7 days" value={counts.due_soon} tone={counts.due_soon > 0 ? "amber" : undefined} />
        </div>
        <p className="text-[12px] text-ink-3 mt-2">
          {lastApproved
            ? `Last signed off ${lastApproved.approvedOn} (${lastApproved.displayId}).`
            : "Not signed off yet."}
        </p>
        {signOffDue && !pendingSubmission && (
          <div className="mt-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-900 text-[12px] p-2.5 flex items-start gap-2">
            <Clock className="w-4 h-4 shrink-0 mt-px" />
            <span>Monthly sign-off is due. Check the list, then submit it.</span>
          </div>
        )}
        <div className="mt-3">
          <SignOffAction
            projectId={config.projectId}
            typeCode={config.typeCode}
            pendingSubmission={pendingSubmission}
            liveCount={counts.all}
            overdueCount={counts.overdue}
          />
        </div>
      </div>

      {/* Filters + search */}
      <div className="sticky top-12 z-10 bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4 py-2 mt-3 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => {
            const active = f === filter;
            const n = counts[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => pickFilter(f)}
                aria-pressed={active}
                className={
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors " +
                  (active ? "bg-ink text-white" : "bg-sandstone-50 text-ink-3 hover:bg-sandstone-100")
                }
              >
                {FILTER_LABELS[f]}
                {n > 0 && (
                  <span
                    className={
                      "ml-0.5 rounded-full text-[10px] font-bold px-1 min-w-[18px] text-center tabular-nums " +
                      (active ? "bg-white/20 text-white" : "bg-ink/10 text-ink")
                    }
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ID or location"
            className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-[14px]"
          />
        </label>
      </div>

      {/* List */}
      <div className="px-4 py-3">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
            <FireExtinguisher className="w-6 h-6 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500 mt-2">
              {rows.length === 0
                ? `No ${config.shortName.toLowerCase()} on the register yet. Tap Add to start the list.`
                : query
                  ? "Nothing matches that search."
                  : filter === "overdue"
                    ? "Nothing overdue. Good."
                    : filter === "due_soon"
                      ? "Nothing due in the next 7 days."
                      : filter === "retired"
                        ? "No retired items."
                        : "No items."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((r) => {
              const s = r.retiredAt ? "none" : stateOf(r);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSheet({ row: r })}
                    className={
                      "w-full text-left rounded-xl border bg-white shadow-sm p-3.5 active:bg-stone-50 flex items-center gap-3 " +
                      (s === "overdue" ? "border-red-200" : "border-stone-200")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[16px] font-bold text-ink truncate">{r.identifier}</span>
                        {typeKey && r.values[typeKey] && (
                          <span className="text-[12px] text-ink-3 truncate">{r.values[typeKey]}</span>
                        )}
                      </div>
                      <p className="text-[12px] text-stone-600 mt-0.5 truncate">
                        {(locationKey && r.values[locationKey]) || "—"}
                        {r.villaLabel ? ` · ${r.villaLabel}` : ""}
                      </p>
                      <div className="mt-1.5">
                        {r.retiredAt ? (
                          <span className="inline-flex rounded-full bg-stone-100 ring-1 ring-stone-300 text-stone-700 px-2 py-0.5 text-[10px] font-semibold">
                            Retired{r.retiredReason ? ` · ${r.retiredReason.slice(0, 40)}` : ""}
                          </span>
                        ) : (
                          <DuePill state={s} label={dueLabel(dueDateKey ? r.values[dueDateKey] : null, todayIso)} />
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] z-30 rounded-full bg-ink text-cream text-[13px] px-4 py-2 shadow-card"
        >
          {toast}
        </div>
      )}

      {sheet && (
        <RegisterRowSheet config={config} row={sheet.row} onClose={() => setSheet(null)} onSaved={onSaved} />
      )}
    </>
  );
}

function SignOffAction({
  projectId,
  typeCode,
  pendingSubmission,
  liveCount,
  overdueCount,
}: {
  projectId: string;
  typeCode: string;
  pendingSubmission: { id: string; displayId: string } | null;
  liveCount: number;
  overdueCount: number;
}) {
  if (pendingSubmission) {
    return (
      <Link
        href={`/mobile/${projectId}/registers/${typeCode}/submissions/${pendingSubmission.id}`}
        className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-amber-900 text-[13px] font-semibold px-3.5 py-3"
      >
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          {pendingSubmission.displayId} waiting for sign-off
        </span>
        <ChevronRight className="w-4 h-4" />
      </Link>
    );
  }
  if (liveCount === 0) return null;
  return (
    <Link
      href={`/mobile/${projectId}/registers/${typeCode}/submit`}
      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3"
    >
      <Send className="w-4 h-4" />
      Submit for sign-off
      {overdueCount > 0 && (
        <span className="inline-flex items-center gap-1 ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px]">
          <AlertTriangle className="w-3 h-3" />
          {overdueCount} overdue
        </span>
      )}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-ink";
  return (
    <div className="rounded-xl bg-cream border border-sandstone-100 px-3 py-2.5">
      <p className={`font-serif text-[26px] leading-none tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-ink-3 mt-1">{label}</p>
    </div>
  );
}

function DuePill({ state, label }: { state: DueState; label: string }) {
  const cls =
    state === "overdue"
      ? "bg-red-50 ring-red-200 text-red-800"
      : state === "due_soon"
        ? "bg-amber-50 ring-amber-200 text-amber-800"
        : state === "ok"
          ? "bg-emerald-50 ring-emerald-200 text-emerald-800"
          : "bg-stone-100 ring-stone-300 text-stone-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {state === "overdue" && <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}
