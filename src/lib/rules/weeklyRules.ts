// Weekly Report — pure aggregation rules.
//
// These functions are the single source of truth for how the Weekly Report's
// numbers are computed. They mirror scripts/build_wk23.py + build_wk30.py from
// the Amanvana Reporting Toolkit v14 exactly (see WEEKLY_HANDOFF.md for the
// spec), and are unit-tested against the Python-generated JSON fixtures in
// tests/fixtures/amanvana-wk/.
//
// Design:
//   - Inputs are plain arrays / dates / strings. No DB, no Prisma.
//   - Outputs match the shape of the Python JSON where useful for testing.
//   - Servers (weeklyReportServer.ts) FETCH data into these shapes and call
//     these rules — the servers do NO business math.
//
// If a rule needs to change to match new Python behavior, update it here +
// its test. That's it.

// ---------------------------------------------------------------------------
// CSV row shape (subset — only the columns we actually read)
// ---------------------------------------------------------------------------
export interface ColabCsvRow {
  Location_Name?: string;         // "Villa 05"
  Sub_Location?: string;          // "Footing", "Plinth Beam", ...
  Activity_Type?: string;
  Activity_Name?: string;
  Milestone?: string;             // END-marker label when set to a MORDER value
  Planned_Start_Date?: string;    // "24-08-26"
  Planned_End_Date?: string;
  Actual_Start?: string;
  Actual_End_Date?: string;
  Progress_Date?: string;
  Physical_Progress?: string;     // per-activity weight (0-100, sums to ~100)
  Reason_for_Delay?: string;
}

// ---------------------------------------------------------------------------
// Date parsing — matches Python's pd.to_datetime(format='%d-%m-%y')
// ---------------------------------------------------------------------------
export function parseColabDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "-") return null;
  // Python uses strict %d-%m-%y; also handle ISO for safety.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const dmy = t.match(/^(\d{2})-(\d{2})-(\d{2,4})$/);
  if (dmy) {
    const day = +dmy[1];
    const mon = +dmy[2] - 1;
    let year = +dmy[3];
    if (year < 100) year = 2000 + year;
    return new Date(Date.UTC(year, mon, day));
  }
  return null;
}

function toFloat(s: string | undefined | null): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// §1 Overall Project Progress
//
// Python (build_wk23.py L12-14):
//   target = sum(Physical_Progress) where Planned_End_Date <= WKE
//   actual = sum(Physical_Progress) where Progress_Date not null AND <= WKE
// ---------------------------------------------------------------------------
export interface OverallProgress {
  target: number;
  actual: number;
  variancePp: number;
  ratio: number;    // 0-100
}

export function computeOverall(rows: ColabCsvRow[], weekEnd: Date): OverallProgress {
  let target = 0;
  let actual = 0;
  for (const r of rows) {
    const pp = toFloat(r.Physical_Progress);
    if (pp == null) continue;
    const pe = parseColabDate(r.Planned_End_Date);
    const pd = parseColabDate(r.Progress_Date);
    if (pe && pe <= weekEnd) target += pp;
    if (pd && pd <= weekEnd) actual += pp;
  }
  target = round(target, 2);
  actual = round(actual, 2);
  return {
    target,
    actual,
    variancePp: round(actual - target, 2),
    ratio: target > 0 ? Math.round((actual / target) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Stage reconstruction — Python parity (build_wk23.py L32-54)
//
// Per WEEKLY_HANDOFF.md §3: walk each villa's rows in CSV order, accumulate
// into a `block` until a row's Milestone column is a MORDER label. That row
// closes the block. The block IS the stage: ps=min(planned starts),
// pe=max(planned ends), started=any Progress_Date ≤ WKE, done=END-marker's
// Actual_End_Date ≤ WKE.
// ---------------------------------------------------------------------------

/** Python MORDER — ordered list of stage END-marker labels used by the
 *  Amanvana schedule. Rows whose CSV Milestone column matches one of these
 *  values are stage END-markers. */
export const MORDER: readonly string[] = [
  "Footing", "Plinth Beam",
  "Gr Floor Slab", "Gr Floor Blockwork",
  "1st Floor Slab", "1st Floor Blockwork",
  "2nd Floor Slab", "2nd Floor Blockwork",
  "Villa Handover",
];
const MORDER_INDEX = new Map(MORDER.map((m, i) => [m, i]));

// BLOCKS map — Abraham Thomas's 41 villa scope. Kept in
// src/lib/projects/amanvana.ts so scorecardServer + weekly rules read from
// one authoritative source. Re-exported here so existing callers of
// ABRAHAM_BLOCKS keep working.
import { AMANVANA_ABRAHAM_BLOCKS, AMANVANA_ABRAHAM_ALL_VILLAS } from "@/lib/projects/amanvana";
export const ABRAHAM_BLOCKS = AMANVANA_ABRAHAM_BLOCKS;
const ABRAHAM_ALL_VILLAS = AMANVANA_ABRAHAM_ALL_VILLAS;

export interface Stage {
  v: string;         // villa short label, e.g. "V05" or "V10 & 11"
  b: string;         // block name, e.g. "Block 02"
  m: string;         // MORDER label (Footing, Plinth Beam, ...)
  ps: Date | null;   // min planned start across block rows
  pe: Date | null;   // max planned end across block rows
  started: boolean;  // any row had Progress_Date ≤ weekEnd
  done: boolean;     // END-marker row's Actual_End_Date ≤ weekEnd
}

/** Reconstruct all stages across Abraham's 41 villas. */
export function reconstructStages(rows: ColabCsvRow[], weekEnd: Date): Stage[] {
  const villaToBlock = new Map<string, string>();
  for (const [b, vs] of Object.entries(ABRAHAM_BLOCKS)) {
    for (const v of vs) villaToBlock.set(v, b);
  }
  const rowsByVilla = new Map<string, ColabCsvRow[]>();
  for (const r of rows) {
    const v = r.Location_Name?.trim();
    if (!v || !villaToBlock.has(v)) continue;
    (rowsByVilla.get(v) ?? rowsByVilla.set(v, []).get(v)!).push(r);
  }
  const stages: Stage[] = [];
  for (const villa of ABRAHAM_ALL_VILLAS) {
    const list = rowsByVilla.get(villa) ?? [];
    let block: ColabCsvRow[] = [];
    for (const r of list) {
      block.push(r);
      const label = r.Milestone?.trim();
      if (!label || label === "nan" || !MORDER_INDEX.has(label)) continue;
      let ps: Date | null = null;
      let pe: Date | null = null;
      let started = false;
      for (const br of block) {
        const bps = parseColabDate(br.Planned_Start_Date);
        const bpe = parseColabDate(br.Planned_End_Date);
        const bpd = parseColabDate(br.Progress_Date);
        if (bps && (!ps || bps < ps)) ps = bps;
        if (bpe && (!pe || bpe > pe)) pe = bpe;
        if (bpd && bpd <= weekEnd) started = true;
      }
      const endActualEnd = parseColabDate(r.Actual_End_Date);
      const done = !!(endActualEnd && endActualEnd <= weekEnd);
      stages.push({
        v: villa.replace("Villa ", "V"),
        b: villaToBlock.get(villa)!,
        m: label,
        ps, pe, started, done,
      });
      block = [];
    }
  }
  return stages;
}

/** Current milestone per villa = earliest MORDER stage not done.
 *  Returns one Stage per villa (or none if the villa is fully closed). */
export function currentByVilla(stages: Stage[]): Map<string, Stage | null> {
  const byV = new Map<string, Stage[]>();
  for (const s of stages) {
    (byV.get(s.v) ?? byV.set(s.v, []).get(s.v)!).push(s);
  }
  const out = new Map<string, Stage | null>();
  for (const villa of ABRAHAM_ALL_VILLAS) {
    const key = villa.replace("Villa ", "V");
    const list = (byV.get(key) ?? []).filter((s) => !s.done);
    list.sort((a, b) => (MORDER_INDEX.get(a.m) ?? 99) - (MORDER_INDEX.get(b.m) ?? 99));
    out.set(key, list[0] ?? null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §2 Milestone Plan buckets (build_wk23.py L69-82)
// ---------------------------------------------------------------------------
export interface MilestoneBuckets {
  toComplete: {
    wkPlan: number;         // open + done that week (Python's wk_plan = len(tc_wk)+len(tc_wk_done))
    wkDone: number;
    wkItems: string[];      // "V25 Plinth Beam" chip labels, open only
    spill: number;
    spillItems: string[];
  };
  toStart: {
    wkPlan: number;         // len(ts_wk)
    wkStarted: number;
    wkItems: string[];
    notStartedItems: string[];
    spill: number;
    spillItems: string[];
  };
  inProgress: {
    plan: number;           // len(ip_plan)
    actual: number;         // len(ip_actual)
    planItems: string[];
    notMovingItems: string[];
  };
}

function stageLbl(s: Stage): string { return `${s.v} ${s.m}`; }
function sortByVillaNum(items: string[]): string[] {
  return [...items].sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return na - nb;
  });
}

export function computeMilestoneBuckets(
  stages: Stage[], weekStart: Date, weekEnd: Date,
): MilestoneBuckets {
  const cur = [...currentByVilla(stages).values()].filter((s): s is Stage => s !== null);

  const tcWk = cur.filter((s) => s.pe && s.pe >= weekStart && s.pe <= weekEnd && !s.done);
  const tcWkDone = cur.filter((s) => s.pe && s.pe >= weekStart && s.pe <= weekEnd && s.done);
  const tcSp = cur.filter((s) => s.pe && s.pe < weekStart && !s.done);

  const tsWk = cur.filter((s) => s.ps && s.ps >= weekStart && s.ps <= weekEnd && !s.done);
  const tsWkStarted = tsWk.filter((s) => s.started);
  const tsWkNotStarted = tsWk.filter((s) => !s.started);
  const tsSp = cur.filter((s) => s.ps && s.ps < weekStart && !s.started && !s.done);

  const ipPlan = cur.filter((s) => s.ps && s.pe && s.ps <= weekEnd && s.pe >= weekStart && !s.done);
  const ipActual = ipPlan.filter((s) => s.started);
  const ipNotMoving = ipPlan.filter((s) => !s.started);

  return {
    toComplete: {
      wkPlan: tcWk.length + tcWkDone.length,
      wkDone: tcWkDone.length,
      wkItems: sortByVillaNum(tcWk.map(stageLbl)),
      spill: tcSp.length,
      spillItems: sortByVillaNum(tcSp.map(stageLbl)),
    },
    toStart: {
      wkPlan: tsWk.length,
      wkStarted: tsWkStarted.length,
      wkItems: sortByVillaNum(tsWk.map(stageLbl)),
      notStartedItems: sortByVillaNum(tsWkNotStarted.map(stageLbl)),
      spill: tsSp.length,
      spillItems: sortByVillaNum(tsSp.map(stageLbl)),
    },
    inProgress: {
      plan: ipPlan.length,
      actual: ipActual.length,
      planItems: sortByVillaNum(ipPlan.map(stageLbl)),
      notMovingItems: sortByVillaNum(ipNotMoving.map(stageLbl)),
    },
  };
}

// ---------------------------------------------------------------------------
// §5 Delay Reasons — normalisation + aggregation (build_wk23.py L194-232)
// ---------------------------------------------------------------------------

/** Normalise a Colab free-text delay reason to the standard bucket label.
 *  Returns null for meta / hygiene notes that should be dropped (per Python
 *  L26-27, L196). */
export function normalizeReason(freeText: string | undefined | null): string | null {
  if (freeText == null) return null;
  const k = String(freeText).trim().toLowerCase();
  if (!k) return null;
  if (k === "nan" || k === "." || k === "work in progress" || k === "delayed update" || k === "late update in collab tools") return null;
  if (k.includes("collab") || k.includes("colab")) return null;
  if (k.includes("change") && k.includes("order")) return "Change orders (design / scope)";
  if (k.includes("drawing")) return "MEP drawing delay";
  if (k.includes("vendor")) return "Vendor change";
  if (k.includes("priorit")) return "Priority change";
  if (k.includes("material") || k.includes("matrial")) return "Materials";
  if (k.includes("manpower") || k.includes("labour") || k.includes("labor") || k.includes("worker") || k.includes("shortage of man")) return "Manpower / labour shortage";
  if (k.includes("climate") || k.includes("weather") || k.includes("rain")) return "Weather / climate";
  if (k.includes("delayed entry") || k.includes("entry")) return "Delayed entry";
  // Python fallback: title-case the raw text.
  return String(freeText).trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export interface DelayReasonRow {
  reason: string;
  acts: number;        // raw row count (Python's len(g))
  nvillas: number;
  villas: string[];    // "V05" format, sorted by number
  avgDelay: number | null;   // avg (WKE - Planned_End_Date) days across LATE rows only
  maxDelay: number | null;   // max ditto
}

/** Group by normalised reason across Abraham villa rows only. Matches
 *  build_wk23.py L207-232. */
export function computeDelayReasons(rows: ColabCsvRow[], weekEnd: Date): DelayReasonRow[] {
  const abrahamVillas = new Set(Object.values(ABRAHAM_BLOCKS).flat());
  const byReason = new Map<string, { rowCount: number; villas: Set<string>; delays: number[] }>();
  for (const r of rows) {
    const villa = r.Location_Name?.trim();
    if (!villa || !abrahamVillas.has(villa)) continue;
    const reason = normalizeReason(r.Reason_for_Delay);
    if (!reason) continue;
    const entry = byReason.get(reason) ?? { rowCount: 0, villas: new Set<string>(), delays: [] };
    entry.rowCount++;
    entry.villas.add(villa);
    const pe = parseColabDate(r.Planned_End_Date);
    if (pe) {
      const days = Math.round((weekEnd.getTime() - pe.getTime()) / 86400000);
      if (days > 0) entry.delays.push(days);
    }
    byReason.set(reason, entry);
  }
  const out: DelayReasonRow[] = [];
  for (const [reason, entry] of byReason) {
    const villas = [...entry.villas]
      .map((v) => v.replace("Villa ", "V"))
      .sort((a, b) => (parseInt(a.match(/\d+/)?.[0] ?? "0") - parseInt(b.match(/\d+/)?.[0] ?? "0")));
    const avg = entry.delays.length > 0
      ? roundHalfToEven(entry.delays.reduce((n, d) => n + d, 0) / entry.delays.length)
      : null;
    const max = entry.delays.length > 0 ? Math.max(...entry.delays) : null;
    out.push({
      reason,
      acts: entry.rowCount,
      nvillas: villas.length,
      villas,
      avgDelay: avg,
      maxDelay: max,
    });
  }
  // Python: sort by acts desc, tie-break alphabetically (pandas groupby's
  // default sort=True yields alpha group order, then reasons.sort is stable
  // on that base ordering).
  out.sort((a, b) => (b.acts - a.acts) || a.reason.localeCompare(b.reason));
  return out;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function round(n: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

/** Python 3's `round(x)` — banker's rounding, half-to-even. Matches
 *  Python 3 for integer rounding of a real number. */
export function roundHalfToEven(x: number): number {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;
  // Exactly .5 → round to even.
  return floor % 2 === 0 ? floor : floor + 1;
}
