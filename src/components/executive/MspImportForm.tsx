"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MspImportFormProps {
  defaultProjectName?: string;
}

interface ImportStats {
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
}

interface ImportResult {
  ok: boolean;
  elapsedMs?: number;
  error?: string;
  stats?: ImportStats;
}

/**
 * Splits the MSP CSV into sub-CSVs so each POST stays comfortably under
 * Vercel's 300s function timeout. Header row + rows above the first block
 * (levels 0-1) are prepended to every chunk so the parser sees the
 * scaffolding it needs.
 *
 * Two-pass split:
 *  1. Split by L2 (block).
 *  2. Any block with more than MAX_VILLAS_PER_CHUNK villas is further split
 *     by L3 (villa) — a single Elegant "Block 24" carried 19 villas and
 *     ~4000 activities, which is > 5 min to import. Sub-chunks re-carry
 *     the block header row so the importer keeps block context.
 */
const MAX_VILLAS_PER_CHUNK = 6;

function splitCsvByBlock(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [csvText];
  const header = lines[0];

  // Find column indexes for "Outline Level" and "Task Name" (order can vary).
  const cols = parseCsvLine(header);
  const levelIdx = cols.findIndex((c) => c.trim() === "Outline Level");
  const nameIdx = cols.findIndex((c) => c.trim() === "Task Name");
  if (levelIdx === -1 || nameIdx === -1) {
    // Unknown format — just fall back to single upload.
    return [csvText];
  }

  // Pre-header rows: everything above the first level-2 (block) row.
  const preamble: string[] = [];
  const blocks: string[][] = [];
  let currentBlock: string[] | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const level = parseInt(cells[levelIdx] ?? "", 10);
    const name = (cells[nameIdx] ?? "").trim();
    if (level === 2 && /^Block\s+/i.test(name)) {
      // Start a new block chunk
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = [line];
    } else if (currentBlock == null) {
      preamble.push(line);
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // Pass 2 — sub-split any block whose villa count exceeds MAX. Each sub-
  // chunk re-carries the block's L2 header row so the importer still binds
  // the villa to the correct block.
  const finalChunks: string[][] = [];
  for (const blockRows of blocks) {
    const blockHeader = blockRows[0];
    // Between block-header and first L3 villa, sometimes there are stray
    // block-level rows (rare, but seen in some exports). Prepend those to
    // the first villa group so nothing is dropped.
    const beforeFirstVilla: string[] = [];
    const villaGroups: string[][] = [];
    let currentVilla: string[] | null = null;
    for (let i = 1; i < blockRows.length; i++) {
      const line = blockRows[i];
      const cells = parseCsvLine(line);
      const level = parseInt(cells[levelIdx] ?? "", 10);
      if (level === 3) {
        if (currentVilla) villaGroups.push(currentVilla);
        currentVilla = [line];
      } else if (currentVilla) {
        currentVilla.push(line);
      } else {
        beforeFirstVilla.push(line);
      }
    }
    if (currentVilla) villaGroups.push(currentVilla);

    if (villaGroups.length <= MAX_VILLAS_PER_CHUNK) {
      // Small enough — one chunk per block, keep original ordering.
      finalChunks.push([blockHeader, ...beforeFirstVilla, ...villaGroups.flat()]);
      continue;
    }
    // Big block — batch villas MAX at a time. The block header + any pre-
    // villa rows are re-emitted at the top of each batch chunk.
    for (let i = 0; i < villaGroups.length; i += MAX_VILLAS_PER_CHUNK) {
      const batch = villaGroups.slice(i, i + MAX_VILLAS_PER_CHUNK).flat();
      finalChunks.push([blockHeader, ...beforeFirstVilla, ...batch]);
    }
  }

  // Assemble one CSV per chunk: header + preamble + block header + rows.
  const preambleBlob = preamble.length ? preamble.join("\n") + "\n" : "";
  return finalChunks.map((rows) => header + "\n" + preambleBlob + rows.join("\n") + "\n");
}

/** Tiny CSV parser (comma-only, quoted-field aware) — no full escape handling. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQuote = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function mergeStats(all: ImportStats[]): ImportStats {
  const merged: ImportStats = {
    projectName: all[0]?.projectName,
    projectId: all[0]?.projectId,
    totalRows: 0,
    totalUnits: 0,
    blocks: { created: 0, updated: 0 },
    villas: { created: 0, updated: 0 },
    sections: { created: 0, updated: 0 },
    villaMilestones: { created: 0, updated: 0 },
    wbsNodes: { created: 0, updated: 0 },
    skipped: { rows: 0, reasons: {} },
  };
  for (const s of all) {
    merged.totalRows! += s.totalRows ?? 0;
    merged.totalUnits! += s.totalUnits ?? 0;
    merged.blocks.created += s.blocks.created;
    merged.blocks.updated += s.blocks.updated;
    merged.villas.created += s.villas.created;
    merged.villas.updated += s.villas.updated;
    merged.sections.created += s.sections.created;
    merged.sections.updated += s.sections.updated;
    merged.villaMilestones.created += s.villaMilestones.created;
    merged.villaMilestones.updated += s.villaMilestones.updated;
    merged.wbsNodes.created += s.wbsNodes.created;
    merged.wbsNodes.updated += s.wbsNodes.updated;
    merged.skipped.rows += s.skipped.rows;
    for (const [k, v] of Object.entries(s.skipped.reasons)) {
      merged.skipped.reasons[k] = (merged.skipped.reasons[k] ?? 0) + v;
    }
  }
  return merged;
}

export default function MspImportForm({ defaultProjectName = "Amanvana" }: MspImportFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setResult(null);
    setProgress(null);
    try {
      const csvText = await file.text();
      const chunks = splitCsvByBlock(csvText);
      setProgress({ done: 0, total: chunks.length });

      const chunkStats: ImportStats[] = [];
      const t0 = Date.now();
      for (let i = 0; i < chunks.length; i++) {
        const res = await fetch("/api/admin/import-msp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: chunks[i], projectName }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(
            `Chunk ${i + 1}/${chunks.length} failed (HTTP ${res.status}): ${body.slice(0, 200)}`,
          );
        }
        const body = (await res.json()) as ImportResult;
        if (body.stats) chunkStats.push(body.stats);
        setProgress({ done: i + 1, total: chunks.length });
      }
      const elapsedMs = Date.now() - t0;
      setResult({ ok: true, elapsedMs, stats: mergeStats(chunkStats) });
      router.refresh();
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
          Uploaded in chunks (one block, or a batch of villas for large blocks) so each request stays under Vercel&apos;s function timeout.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !file}
          className="inline-flex items-center rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
        >
          {submitting ? "Importing..." : "Import schedule"}
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
