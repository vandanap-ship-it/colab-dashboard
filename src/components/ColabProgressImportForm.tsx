"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Stats {
  totalRows: number;
  matchedRows: number;
  matchedActivityRows: number;
  unmatchedRows: number;
  unmatchedSamples: Array<{
    line: number;
    villa: string;
    section: string;
    activity: string;
    reason: string;
  }>;
  villasNotFound: string[];
  sectionsUnmatched: string[];
  progressEntriesCreated: number;
  progressEntriesUpdated: number;
  photosCreated: number;
  wbsNodesUpdated: number;
  villaMilestonesUpdated: number;
  contractorsCreated: string[];
  elapsedMs: number;
}

interface Result {
  ok: boolean;
  stats?: Stats;
  error?: string;
  dryRun: boolean;
}

/**
 * Split the Colab progress CSV into per-villa sub-CSVs so each POST completes
 * well under Vercel's 5-min function timeout. Preserves the header row.
 * Rows without a recognisable Location_Name land in the last chunk.
 */
function splitByVilla(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [csvText];
  const header = lines[0];
  const cols = header.split(",");
  const locIdx = cols.findIndex((c) => c.trim() === "Location_Name");
  if (locIdx === -1) return [csvText];

  const byVilla = new Map<string, string[]>();
  const orphans: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Cheap parse — Colab exports don't quote commas in Location_Name.
    const cells = line.split(",");
    const villa = (cells[locIdx] ?? "").trim();
    if (!villa) {
      orphans.push(line);
      continue;
    }
    const arr = byVilla.get(villa) ?? [];
    arr.push(line);
    byVilla.set(villa, arr);
  }

  // Villas roughly balanced (~175 rows each), so per-villa chunks are ideal.
  const chunks: string[] = [];
  for (const rows of byVilla.values()) {
    chunks.push(header + "\n" + rows.join("\n") + "\n");
  }
  if (orphans.length) chunks.push(header + "\n" + orphans.join("\n") + "\n");
  return chunks;
}

function mergeStats(all: Stats[]): Stats {
  const out: Stats = {
    totalRows: 0,
    matchedRows: 0,
    matchedActivityRows: 0,
    unmatchedRows: 0,
    unmatchedSamples: [],
    villasNotFound: [],
    sectionsUnmatched: [],
    progressEntriesCreated: 0,
    progressEntriesUpdated: 0,
    photosCreated: 0,
    wbsNodesUpdated: 0,
    villaMilestonesUpdated: 0,
    contractorsCreated: [],
    elapsedMs: 0,
  };
  const seenSections = new Set<string>();
  const seenVillas = new Set<string>();
  const seenContractors = new Set<string>();
  for (const s of all) {
    out.totalRows += s.totalRows;
    out.matchedRows += s.matchedRows;
    out.matchedActivityRows += s.matchedActivityRows;
    out.unmatchedRows += s.unmatchedRows;
    out.progressEntriesCreated += s.progressEntriesCreated;
    out.progressEntriesUpdated += s.progressEntriesUpdated;
    out.photosCreated += s.photosCreated;
    out.wbsNodesUpdated += s.wbsNodesUpdated;
    out.villaMilestonesUpdated += s.villaMilestonesUpdated;
    out.elapsedMs += s.elapsedMs;
    for (const v of s.villasNotFound) if (!seenVillas.has(v)) { seenVillas.add(v); out.villasNotFound.push(v); }
    for (const x of s.sectionsUnmatched) if (!seenSections.has(x)) { seenSections.add(x); out.sectionsUnmatched.push(x); }
    for (const c of s.contractorsCreated) if (!seenContractors.has(c)) { seenContractors.add(c); out.contractorsCreated.push(c); }
    for (const u of s.unmatchedSamples) if (out.unmatchedSamples.length < 30) out.unmatchedSamples.push(u);
  }
  return out;
}

export default function ColabProgressImportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [projectFilter, setProjectFilter] = useState("AMANVANA");
  const [defaultContractor, setDefaultContractor] = useState("Abraham Thomas");
  const [dryRun, setDryRun] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setResult(null);
    setProgress(null);
    try {
      const csv = await file.text();
      const chunks = splitByVilla(csv);
      setProgress({ done: 0, total: chunks.length });
      const collected: Stats[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const res = await fetch("/api/admin/import-colab-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv: chunks[i],
            projectId,
            dryRun,
            projectName: projectFilter.trim() || undefined,
            defaultContractorName: defaultContractor.trim() || undefined,
          }),
        });
        const raw = await res.text();
        let body: { ok?: boolean; stats?: Stats; error?: string };
        try {
          body = JSON.parse(raw);
        } catch {
          throw new Error(
            `Chunk ${i + 1}/${chunks.length} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 200)}`,
          );
        }
        if (!res.ok || !body.ok) {
          throw new Error(
            `Chunk ${i + 1}/${chunks.length} failed: ${body.error ?? `HTTP ${res.status}`}`,
          );
        }
        if (body.stats) collected.push(body.stats);
        setProgress({ done: i + 1, total: chunks.length });
      }
      setResult({ ok: true, stats: mergeStats(collected), dryRun });
      if (!dryRun) router.refresh();
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
          Only imports rows whose <code>Project_Name</code> matches. Leave blank to import all rows in the CSV.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
          Default contractor (for rows with blank Contractor_Name)
        </span>
        <input
          value={defaultContractor}
          onChange={(e) => setDefaultContractor(e.target.value)}
          className={`${inputCls} mt-1`}
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          Colab exports leave most rows blank. For Amanvana all historical
          progress belongs to <strong>Abraham Thomas</strong>, so that&apos;s the safe default.
          Leave blank to skip auto-tagging.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
          CollabTools progress CSV
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={`${inputCls} mt-1 file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700`}
          required
        />
        <span className="block text-[10px] text-stone-400 mt-1">
          The master export CSV from Colab. Headers must include{" "}
          <code>Location_Name</code>, <code>Sub_Location</code>, <code>Activity_Type</code>, <code>Progress_Date</code>, <code>Total__Progress_%</code>, and <code>Activity_ID</code>.
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
          <strong>Dry run</strong> — parse + match only, don&apos;t write to the DB.
          <span className="block text-[10px] text-stone-400">
            Recommended for the first run so you can review the match report before touching the schedule.
          </span>
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
        {progress && (
          <span className="text-sm text-stone-600">
            Chunk {progress.done} / {progress.total}
            {progress.done < progress.total && " …"}
          </span>
        )}
      </div>

      {result && (
        <div className={`rounded-lg border p-4 ${result.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          {result.ok && result.stats ? (
            <>
              <div className="text-sm font-semibold text-emerald-900 mb-2">
                ✓ {result.dryRun ? "Dry-run complete" : "Import complete"} in {(result.stats.elapsedMs / 1000).toFixed(1)}s
              </div>
              <ul className="text-xs text-stone-700 space-y-1 font-mono">
                <li>Rows in CSV: <strong>{result.stats.totalRows}</strong></li>
                <li>Matched to villa + section: <strong>{result.stats.matchedRows}</strong></li>
                <li>Also matched to specific activity: <strong>{result.stats.matchedActivityRows}</strong></li>
                <li className="text-orange-700">Unmatched: <strong>{result.stats.unmatchedRows}</strong></li>
                {!result.dryRun && (
                  <>
                    <li className="pt-2">Progress entries created: <strong>{result.stats.progressEntriesCreated}</strong></li>
                    <li>Progress entries updated: <strong>{result.stats.progressEntriesUpdated}</strong></li>
                    <li>Photos created: <strong>{result.stats.photosCreated}</strong></li>
                    <li>WBS nodes updated: <strong>{result.stats.wbsNodesUpdated}</strong></li>
                    <li>Villa milestones rolled up: <strong>{result.stats.villaMilestonesUpdated}</strong></li>
                  </>
                )}
                {result.stats.contractorsCreated.length > 0 && (
                  <li className="pt-2">
                    {result.dryRun ? "Contractors that WOULD be created" : "Contractors created"}: {result.stats.contractorsCreated.join(", ")}
                  </li>
                )}
                {result.stats.villasNotFound.length > 0 && (
                  <li className="text-orange-700 pt-2">
                    Villa numbers in CSV but not in project: {result.stats.villasNotFound.slice(0, 30).join(", ")}
                    {result.stats.villasNotFound.length > 30 && ` (+${result.stats.villasNotFound.length - 30} more)`}
                  </li>
                )}
                {result.stats.sectionsUnmatched.length > 0 && (
                  <li className="text-orange-700 pt-2">
                    Section combos with no mapping ({result.stats.sectionsUnmatched.length} unique):
                    <ul className="mt-1 ml-4">
                      {result.stats.sectionsUnmatched.slice(0, 15).map((s) => (
                        <li key={s} className="text-[11px]">- {s}</li>
                      ))}
                      {result.stats.sectionsUnmatched.length > 15 && (
                        <li className="text-[11px] italic">+{result.stats.sectionsUnmatched.length - 15} more</li>
                      )}
                    </ul>
                  </li>
                )}
                {result.stats.unmatchedSamples.length > 0 && (
                  <li className="text-orange-700 pt-2">
                    Sample of unmatched rows (first {result.stats.unmatchedSamples.length}):
                    <ul className="mt-1 ml-4">
                      {result.stats.unmatchedSamples.map((s, i) => (
                        <li key={i} className="text-[11px]">
                          line {s.line}: {s.villa} · {s.section} · {s.activity} → <span className="text-red-700">{s.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
              {result.dryRun && result.stats.matchedRows > 0 && (
                <div className="text-xs text-emerald-900 mt-3 border-t border-emerald-200 pt-2">
                  Match rate looks OK? Uncheck &quot;Dry run&quot; and click <em>Import to database</em> to write.
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
