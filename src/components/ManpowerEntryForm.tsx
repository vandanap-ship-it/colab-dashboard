"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";
import SaveSuccessCard from "./SaveSuccessCard";
import { istDayString } from "@/lib/istDay";
import { ScreenHeading, FieldLabel, PrimaryAction } from "./mobile/ui";

export interface ContractorOption {
  id: string;
  name: string;
  category: string;
}

export interface ManpowerEntryFormProps {
  projectId: string;
  projectName: string;
  contractors: ContractorOption[];
  trades: string[];
}

/**
 * Mobile form for a site engineer to log actual manpower.
 *
 * Reference-aligned with the New Progress form: one screen, one contractor,
 * and a repeating trade+count row block with an "+ Add row" affordance so
 * the engineer can log every trade for a contractor in a single save
 * without navigating away between entries.
 *
 * Server contract stays a per-row upsert on `(projectId, contractorId, trade,
 * entryDate)` — the form fans out one POST per non-empty row so a resubmit
 * of the same trade updates rather than duplicates. If any row fails we
 * report which one, but rows that already saved stay saved.
 */
export default function ManpowerEntryForm({
  projectId,
  projectName,
  contractors,
  trades,
}: ManpowerEntryFormProps) {
  const router = useRouter();
  const toast = useToast();

  const today = useMemo(() => istDayString(), []);

  type Row = { trade: string; count: string };
  const initialRows = (): Row[] => [{ trade: trades[0] ?? "", count: "" }];

  const [entryDate, setEntryDate] = useState<string>(today);
  const [contractorId, setContractorId] = useState<string>(contractors[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>(initialRows());
  const [notes, setNotes] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After save: in-place success card so an engineer logging trade-by-trade
  // doesn't get bounced home after every entry. See SaveSuccessCard.
  const [saved, setSaved] = useState<null | { queued: boolean; totalHead: number; rowCount: number }>(null);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    // Pick the next trade the engineer hasn't already added, so the fresh row
    // isn't a duplicate they immediately have to change. Falls back to the
    // first trade if every trade is already listed.
    const used = new Set(rows.map((r) => r.trade));
    const nextTrade = trades.find((t) => !used.has(t)) ?? trades[0] ?? "";
    setRows((prev) => [...prev, { trade: nextTrade, count: "" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!contractorId) { setError("Pick a contractor"); return; }

    // Only rows with a real count get sent — blank rows are ignored, matching
    // Progress form behaviour where an empty "0" row is a no-op.
    const parsedRows = rows
      .map((r, idx) => ({ idx, trade: r.trade, count: r.count, n: Number(r.count) }))
      .filter((r) => r.trade && r.count !== "" && Number.isFinite(r.n));
    if (parsedRows.length === 0) {
      setError("Enter at least one trade with a headcount");
      return;
    }
    const bad = parsedRows.find((r) => r.n < 0);
    if (bad) { setError(`Row ${bad.idx + 1}: headcount can't be negative`); return; }

    // Reject duplicate trades in the same submission — the server would
    // upsert one over the other, which is worse than telling the engineer
    // to consolidate before saving.
    const seen = new Set<string>();
    for (const r of parsedRows) {
      if (seen.has(r.trade)) { setError(`Trade "${r.trade}" appears twice — remove one row`); return; }
      seen.add(r.trade);
    }

    setPending(true);

    let queued = false;
    let failed: string | null = null;
    let sentTotal = 0;
    for (const r of parsedRows) {
      const payload = {
        idempotencyKey: crypto.randomUUID(),
        projectId,
        contractorId,
        trade: r.trade,
        entryDate,
        actualCount: Math.floor(r.n),
        notes: notes.trim() || undefined,
      };
      try {
        const res = await fetch("/api/manpower-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          sentTotal += Math.floor(r.n);
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          const data = await res.json().catch(() => null);
          failed = data?.error ?? `Row ${r.idx + 1} failed (${res.status})`;
          break;
        }
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/manpower-entries", method: "POST", body: payload, label: `Manpower · ${r.trade}` });
        sentTotal += Math.floor(r.n);
        queued = true;
      } catch {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/manpower-entries", method: "POST", body: payload, label: `Manpower · ${r.trade}` });
        sentTotal += Math.floor(r.n);
        queued = true;
      }
    }

    setPending(false);
    if (failed) { setError(failed); return; }

    if (queued) toast.info("Saved on this device. Some rows will sync when you're back online.");
    else toast.success("Manpower logged.");
    setSaved({ queued, totalHead: sentTotal, rowCount: parsedRows.length });
    router.refresh();
  }

  function resetForm() {
    setEntryDate(today);
    setRows(initialRows());
    setNotes("");
    setError(null);
    setSaved(null);
  }

  if (saved) {
    const contractorName =
      contractors.find((c) => c.id === contractorId)?.name ?? "contractor";
    return (
      <SaveSuccessCard
        title="Manpower logged"
        detail={`${saved.totalHead} heads across ${saved.rowCount} trade${saved.rowCount === 1 ? "" : "s"} · ${contractorName}`}
        projectId={projectId}
        onAddAnother={resetForm}
        queued={saved.queued}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
      <ScreenHeading
        title="Log manpower"
        lede={`Pick the contractor and add a row for every trade on site today · ${projectName}`}
      />

      <label className="block">
        <FieldLabel>Date</FieldLabel>
        <input
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
        />
      </label>

      <label className="block">
        <FieldLabel>Contractor</FieldLabel>
        <select
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
        >
          {contractors.length === 0 && <option value="">No contractors on this project</option>}
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      {/* Trade rows — mirrors the Labour block on New Progress: one dropdown
          + count per row, "+ Add row" appends. Saving fans out one row per
          POST so upserts by (contractor, trade, date) still work per-row. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[13px] font-semibold text-ink">Trades on site</span>
          <button
            type="button"
            onClick={addRow}
            className="text-[13px] text-ferrous-600 font-medium"
          >
            + Add row
          </button>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={row.trade}
              onChange={(e) => updateRow(i, { trade: e.target.value })}
              className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
            >
              {trades.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              pattern="[0-9]*"
              value={row.count}
              onChange={(e) => updateRow(i, { count: e.target.value.replace(/[^\d]/g, "") })}
              placeholder="0"
              className="w-24 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] tabular-nums"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-stone-400 hover:text-red-500 text-lg min-h-11 min-w-11 flex items-center justify-center"
                aria-label="Remove row"
              >
                🗑
              </button>
            )}
          </div>
        ))}
        <p className="text-[12px] text-ink-3 mt-1">
          Adding the same trade again today just updates the previous number.
        </p>
      </div>

      <label className="block">
        <FieldLabel optional>Notes</FieldLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. three workers arrived late due to bus delay"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
        />
      </label>

      {error && <p className="text-sm text-ferrous-600">{error}</p>}

      <PrimaryAction disabled={pending || contractors.length === 0}>
        {pending ? "Saving…" : "Save entry"}
      </PrimaryAction>
    </form>
  );
}
