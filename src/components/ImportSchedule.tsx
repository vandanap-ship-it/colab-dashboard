"use client";

import { useState } from "react";

export default function ImportSchedule({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ inserted: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setPending(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    if (replace) fd.set("replace", "true");
    const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: fd });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? `HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    setResult(data);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Import schedule</h1>
        <p className="text-sm text-stone-500 mt-1">
          Upload a CSV of the WBS for <span className="font-medium">{projectName}</span>.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-stone-200 bg-white p-6 space-y-4"
      >
        <div>
          <label className="text-sm font-medium text-stone-700">CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm text-stone-700 file:mr-4 file:rounded-full file:border-0 file:bg-stone-900 file:text-white file:px-4 file:py-2 file:text-sm file:font-medium"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Wipe existing WBS for this project before importing
        </label>

        <button
          type="submit"
          disabled={!file || pending}
          className="rounded-full bg-stone-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <div className="text-sm">
            <p className="text-emerald-600">Imported {result.inserted} rows.</p>
            {result.warnings.length > 0 && (
              <ul className="mt-2 text-amber-700 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      <div className="rounded-xl border border-stone-200 bg-ivory p-4 text-xs text-stone-600 space-y-2">
        <p className="font-medium text-stone-800">Required columns:</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li><code>Task Name</code> — the activity or grouping label</li>
          <li><code>Outline Level</code> — integer 1+ (1 = top-level, 2 = child of 1, etc.)</li>
        </ul>
        <p className="font-medium text-stone-800 pt-2">Optional columns (auto-detected):</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li><code>Baseline Start</code>, <code>Baseline Finish</code>, <code>Actual Start</code>, <code>Actual Finish</code>, <code>Finish</code></li>
          <li><code>% Complete</code>, <code>Predecessors</code></li>
          <li><code>Category</code>, <code>Total Quantity</code>, <code>Unit</code>, <code>Contractor</code></li>
        </ul>
        <p className="pt-2">
          From MS Project: <span className="font-mono">File → Save As → CSV (Comma delimited)</span>. Make sure the
          <span className="font-mono"> Outline Level</span> column is included.
        </p>
      </div>
    </div>
  );
}
