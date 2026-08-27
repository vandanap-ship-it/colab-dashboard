"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Stats {
  totalRows: number;
  skippedRows: number;
  skippedContractors: string[];
  contractorsCreated: string[];
  tradePlansCreated: number;
  tradePlansUpdated: number;
  manpowerEntriesCreated: number;
  manpowerEntriesUpdated: number;
  unmappedTrades: string[];
  elapsedMs: number;
}

interface Result {
  ok: boolean;
  stats?: Stats;
  error?: string;
  dryRun: boolean;
}

export default function ColabManpowerImportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [projectFilter, setProjectFilter] = useState("AMANVANA");
  const [ignoreCsv, setIgnoreCsv] = useState("Charge Infra");
  const [dryRun, setDryRun] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setResult(null);
    try {
      const csv = await file.text();
      const ignoreContractors = ignoreCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/admin/import-colab-manpower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          projectId,
          dryRun,
          projectName: projectFilter.trim() || undefined,
          ignoreContractors,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setResult({ ok: false, error: body.error ?? `HTTP ${res.status}`, dryRun });
      } else {
        setResult({ ok: true, stats: body.stats, dryRun });
        if (!dryRun) router.refresh();
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        dryRun,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
          Colab project name filter
        </span>
        <input
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={`${inputCls} mt-1`}
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Only imports rows whose <code>Project_Name</code> matches. Leave blank to import all.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
          Ignore these contractors (comma-separated)
        </span>
        <input
          value={ignoreCsv}
          onChange={(e) => setIgnoreCsv(e.target.value)}
          className={`${inputCls} mt-1`}
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Names to skip (matched after stripping <code>NA-</code> prefix, case-insensitive). Default skips Charge Infra per Shraddha&apos;s 2026-08-28 call.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
          Manpower CSV
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={`${inputCls} mt-1 file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700`}
          required
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Must have columns:{" "}
          <code>Contractor_Name</code>, <code>Date</code>, <code>Trade_Name</code>,{" "}
          <code>Planned_Labour</code>, <code>Actual_Labour</code>, <code>Project_Name</code>.
        </span>
      </label>

      <label className="flex items-center gap-3 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => setDryRun(e.target.checked)}
          className="w-4 h-4"
        />
        <span>
          <strong>Dry run</strong> — parse only, don&apos;t write to the DB.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !file}
          className="inline-flex items-center rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
        >
          {submitting ? (dryRun ? "Running dry-run…" : "Importing…") : dryRun ? "Run dry-run" : "Import to database"}
        </button>
      </div>

      {result && (
        <div className={`rounded-lg border p-4 ${result.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          {result.ok && result.stats ? (
            <>
              <div className="text-sm font-semibold text-emerald-900 mb-2">
                ✓ {result.dryRun ? "Dry-run complete" : "Import complete"} in {(result.stats.elapsedMs / 1000).toFixed(1)}s
              </div>
              <ul className="text-xs text-stone-700 space-y-1 font-mono">
                <li>Rows read: <strong>{result.stats.totalRows}</strong></li>
                <li>Rows skipped: <strong>{result.stats.skippedRows}</strong></li>
                <li>Trade plans {result.dryRun ? "that would be created" : "created"}: <strong>{result.stats.tradePlansCreated}</strong></li>
                <li>Manpower entries {result.dryRun ? "that would be created" : "created"}: <strong>{result.stats.manpowerEntriesCreated}</strong></li>
                {result.stats.manpowerEntriesUpdated > 0 && (
                  <li>Manpower entries updated: <strong>{result.stats.manpowerEntriesUpdated}</strong></li>
                )}
                {result.stats.contractorsCreated.length > 0 && (
                  <li className="pt-2">
                    Contractors {result.dryRun ? "that would be created" : "created"}: {result.stats.contractorsCreated.join(", ")}
                  </li>
                )}
                {result.stats.skippedContractors.length > 0 && (
                  <li className="text-orange-700 pt-2">
                    Ignored contractors: {result.stats.skippedContractors.join(", ")}
                  </li>
                )}
                {result.stats.unmappedTrades.length > 0 && (
                  <li className="text-orange-700 pt-2">
                    Trade names in CSV but not in Siddhi&apos;s TRADES list: {result.stats.unmappedTrades.join(", ")}
                    <br />
                    <span className="text-[10px]">(These rows were still imported using the raw name. Consider adding an alias or extending TRADES.)</span>
                  </li>
                )}
              </ul>
              {result.dryRun && (
                <div className="text-xs text-emerald-900 mt-3 border-t border-emerald-200 pt-2">
                  Numbers look right? Uncheck &quot;Dry run&quot; and click <em>Import to database</em>.
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-red-900">
              ✗ {result.error ?? "Import failed"}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
