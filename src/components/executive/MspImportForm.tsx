"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MspImportFormProps {
  defaultProjectName?: string;
}

interface ImportResult {
  ok: boolean;
  elapsedMs?: number;
  error?: string;
  stats?: {
    projectName?: string;
    projectId?: string;
    totalRows?: number;
    totalUnits?: number;
    blocks: { created: number; updated: number };
    villas: { created: number; updated: number };
    sections: { created: number; updated: number };
    villaMilestones: { created: number; updated: number };
    wbsNodes: { created: number; updated: number };
    skipped: { rows: number; reasons: Record<string, number> };
  };
}

/**
 * Admin-only file uploader for MSP CSVs (the output of
 * scripts/convert-mpp.py, which converts a .mpp binary into a CSV). Posts to
 * /api/admin/import-msp and shows the per-entity stats on success.
 */
export default function MspImportForm({ defaultProjectName = "Amanvana" }: MspImportFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectName", projectName);
      const res = await fetch("/api/admin/import-msp", { method: "POST", body: form });
      const body = (await res.json()) as ImportResult;
      setResult(res.ok ? body : { ok: false, error: body.error ?? "Import failed" });
      if (res.ok) router.refresh();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Project name</span>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className={`${inputCls} mt-1`}
          required
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Reuses the existing project if a name match exists; creates it otherwise.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">MSP CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={`${inputCls} mt-1 file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700`}
          required
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Produced by <code className="font-mono">scripts/convert-mpp.py &lt;.mpp&gt; &lt;output.csv&gt;</code>.
          Must have &quot;Task Name&quot; + &quot;Outline Level&quot; columns.
          File cap 20MB.
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !file}
          className="inline-flex items-center rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
        >
          {submitting ? "Importing (may take up to 5 minutes)..." : "Import schedule"}
        </button>
      </div>

      {result && (
        <div className={`rounded-lg border p-4 ${result.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          {result.ok && result.stats ? (
            <>
              <div className="text-sm font-semibold text-emerald-900 mb-2">
                ✓ Import complete{result.elapsedMs ? ` in ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}
              </div>
              <ul className="text-xs text-stone-700 space-y-1 font-mono">
                <li>Project: <strong>{result.stats.projectName}</strong> ({result.stats.projectId?.slice(0, 8)}...)</li>
                <li>Rows read: {result.stats.totalRows} · Physical units: {result.stats.totalUnits}</li>
                <li>Blocks: {result.stats.blocks.created} created · {result.stats.blocks.updated} updated</li>
                <li>Villas: {result.stats.villas.created} created · {result.stats.villas.updated} updated</li>
                <li>Sections: {result.stats.sections.created} created · {result.stats.sections.updated} updated</li>
                <li>Villa milestones: {result.stats.villaMilestones.created} created · {result.stats.villaMilestones.updated} updated</li>
                <li>WBS nodes: {result.stats.wbsNodes.created} created · {result.stats.wbsNodes.updated} updated</li>
                {result.stats.skipped.rows > 0 && (
                  <li className="text-orange-700">
                    Skipped {result.stats.skipped.rows} rows: {Object.entries(result.stats.skipped.reasons).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </li>
                )}
              </ul>
              <div className="text-xs text-emerald-900 mt-3">
                Refresh any Overview / Layout / Timeline tab to see live data.
              </div>
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
