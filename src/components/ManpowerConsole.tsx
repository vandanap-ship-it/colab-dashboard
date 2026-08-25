"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";
import {
  dashboardStrip,
  daySummary,
  type ManpowerEntryRow,
  type TradePlanRow,
} from "@/lib/manpower";

export interface ContractorOption {
  id: string;
  name: string;
  category: string;
}

export interface PlanRow {
  id: string;
  contractorId: string;
  contractorName: string;
  trade: string;
  plannedCount: number;
  startDate: string;   // ISO
  endDate: string | null;
  notes: string | null;
}

export interface EntryRow {
  id: string;
  contractorId: string;
  contractorName: string;
  trade: string;
  entryDate: string;   // ISO
  actualCount: number;
  notes: string | null;
  loggedByName: string;
  loggedAt: string;
}

export interface ManpowerConsoleProps {
  projectId: string;
  day: string; // "YYYY-MM-DD"
  contractors: ContractorOption[];
  trades: string[];
  plans: PlanRow[];
  entries: EntryRow[];
  canEdit: boolean;
}

export default function ManpowerConsole({
  projectId,
  day,
  contractors,
  trades,
  plans,
  entries,
  canEdit,
}: ManpowerConsoleProps) {
  const router = useRouter();
  const toast = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const dayDate = new Date(day + "T00:00:00Z");

  // Turn PlanRow[] / EntryRow[] into the pure-logic shapes so we reuse daySummary.
  const planRows: TradePlanRow[] = useMemo(
    () => plans.map((p) => ({
      contractorId: p.contractorId,
      trade: p.trade,
      plannedCount: p.plannedCount,
      startDate: new Date(p.startDate),
      endDate: p.endDate ? new Date(p.endDate) : null,
    })),
    [plans],
  );
  const entryRows: ManpowerEntryRow[] = useMemo(
    () => entries.map((e) => ({
      contractorId: e.contractorId,
      trade: e.trade,
      entryDate: new Date(e.entryDate),
      actualCount: e.actualCount,
    })),
    [entries],
  );

  const summary = useMemo(() => dashboardStrip(planRows, entryRows, dayDate), [planRows, entryRows, dayDate]);
  const perDay = useMemo(() => daySummary(planRows, entryRows, dayDate), [planRows, entryRows, dayDate]);

  // For the editor: current planned count per (contractor, trade).
  const currentPlanFor = (contractorId: string, trade: string): PlanRow | undefined =>
    plans.find(
      (p) => p.contractorId === contractorId && p.trade === trade && p.endDate === null,
    );

  async function savePlan(contractorId: string, trade: string, plannedCount: number) {
    const key = `${contractorId}::${trade}`;
    setPendingKey(key);
    try {
      const res = await fetch(`/api/projects/${projectId}/trade-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractorId,
          trade,
          plannedCount,
          startDate: day, // effective from the day we're viewing
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? `Save failed (${res.status})`);
      } else {
        toast.success("Trade plan saved.");
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Day-picker + summary strip */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Viewing</div>
            <label className="mt-1 inline-flex items-center gap-2">
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) router.push(`/projects/${projectId}/manpower?date=${v}`);
                }}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Planned</div>
              <div className="mt-1 text-2xl font-bold text-stone-900 tabular-nums leading-none">{summary.planned}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Actual</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums leading-none ${summary.status === "above" ? "text-emerald-700" : summary.status === "below" ? "text-red-700" : "text-stone-900"}`}>
                {summary.actual}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">% of plan</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums leading-none ${summary.status === "above" ? "text-emerald-700" : summary.status === "below" ? "text-red-700" : "text-stone-900"}`}>
                {summary.pctOfPlan == null ? "—" : `${summary.pctOfPlan}%`}
              </div>
            </div>
            <StatusPill status={summary.status} variance={summary.variance} />
          </div>
        </div>
      </div>

      {/* Planned headcount editor */}
      <section className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
        <header className="border-b border-stone-200 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-900">Planned Headcount</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {canEdit
                ? `Editable — sets the daily target from ${fmtDay(day)} onward.`
                : "Read-only — only admins, planners and product team can change plans."}
            </p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-[10px] uppercase tracking-[0.12em] text-stone-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Contractor</th>
                {trades.map((t) => (
                  <th key={t} className="px-4 py-2.5 text-right font-semibold">{t}</th>
                ))}
                <th className="px-4 py-2.5 text-right font-semibold">Daily total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {contractors.map((c) => {
                const rowTotal = trades.reduce((n, trade) => {
                  const p = currentPlanFor(c.id, trade);
                  return n + (p?.plannedCount ?? 0);
                }, 0);
                return (
                  <tr key={c.id} className="hover:bg-stone-50/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-stone-900">{c.name}</div>
                      <div className="text-[10px] text-stone-500">{c.category}</div>
                    </td>
                    {trades.map((trade) => {
                      const plan = currentPlanFor(c.id, trade);
                      const key = `${c.id}::${trade}`;
                      return (
                        <td key={trade} className="px-4 py-2.5 text-right">
                          <PlanCell
                            initialValue={plan?.plannedCount ?? 0}
                            disabled={!canEdit || pendingKey === key}
                            onCommit={(v) => savePlan(c.id, trade, v)}
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-stone-900">
                      {rowTotal}
                    </td>
                  </tr>
                );
              })}
              {contractors.length === 0 && (
                <tr>
                  <td colSpan={trades.length + 2} className="px-4 py-6 text-center text-sm text-stone-500">
                    No active contractors. Add one from Admin → Contractors first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actuals for the selected day */}
      <section className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
        <header className="border-b border-stone-200 px-5 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-900">Actuals · {fmtDay(day)}</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Site engineers log actual headcount from mobile. Rows below show what was recorded for this day.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-[10px] uppercase tracking-[0.12em] text-stone-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Contractor</th>
                <th className="px-4 py-2.5 text-left font-semibold">Trade</th>
                <th className="px-4 py-2.5 text-right font-semibold">Planned</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actual</th>
                <th className="px-4 py-2.5 text-right font-semibold">Δ</th>
                <th className="px-4 py-2.5 text-left font-semibold">Logged by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {perDay.trades.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-stone-500">
                    Nothing logged for this day yet.
                  </td>
                </tr>
              )}
              {perDay.trades.map((cell) => {
                const contractor = contractors.find((c) => c.id === cell.contractorId);
                const entry = entries.find((e) => e.contractorId === cell.contractorId && e.trade === cell.trade);
                return (
                  <tr key={`${cell.contractorId}::${cell.trade}`}>
                    <td className="px-4 py-2.5">{contractor?.name ?? cell.contractorId}</td>
                    <td className="px-4 py-2.5">{cell.trade}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{cell.planned}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {entry ? cell.actual : <span className="text-stone-400 italic">—</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${cell.variance > 0 ? "text-emerald-700" : cell.variance < 0 ? "text-red-700" : "text-stone-500"}`}>
                      {entry ? (cell.variance > 0 ? `+${cell.variance}` : cell.variance) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-500">
                      {entry?.loggedByName ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PlanCell({
  initialValue,
  disabled,
  onCommit,
}: {
  initialValue: number;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [value, setValue] = useState<string>(String(initialValue));
  const [dirty, setDirty] = useState(false);

  const commit = () => {
    const n = Math.max(0, Math.floor(Number(value)));
    if (Number.isFinite(n) && dirty) {
      onCommit(n);
      setDirty(false);
    }
  };

  return (
    <input
      type="number"
      min={0}
      value={value}
      disabled={disabled}
      onChange={(e) => { setValue(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      className="w-16 rounded border border-stone-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-stone-50 disabled:text-stone-400"
    />
  );
}

function StatusPill({ status, variance }: { status: "no-plan" | "above" | "on-plan" | "below" | "not-logged"; variance: number }) {
  const config = {
    "no-plan":    { label: "No plan",       bg: "bg-stone-100",  fg: "text-stone-600" },
    "not-logged": { label: "Not logged",    bg: "bg-amber-100",  fg: "text-amber-800" },
    above:        { label: `+${variance} above plan`, bg: "bg-emerald-100", fg: "text-emerald-800" },
    "on-plan":    { label: "On plan",       bg: "bg-blue-100",   fg: "text-blue-800" },
    below:        { label: `${variance} below plan`, bg: "bg-red-100",  fg: "text-red-800" },
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${config.bg} ${config.fg}`}>
      {config.label}
    </span>
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
