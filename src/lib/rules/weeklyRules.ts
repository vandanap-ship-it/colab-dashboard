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

/** BLOCKS map — Abraham Thomas's 41 villa scope, keyed by block name.
 *  Matches build_data.py BLOCKS exactly. Villas OUTSIDE this map are
 *  Contractor 2 (Elegant) or unassigned; they never enter the weekly's
 *  milestone maths per WEEKLY_HANDOFF.md rule 2. */
export const ABRAHAM_BLOCKS: Record<string, string[]> = {
  "Block 02": ["Villa 03","Villa 04","Villa 05","Villa 06","Villa 07","Villa 08"],
  "Block 03": ["Villa 09","Villa 10 & 11"],
  "Block 04": ["Villa 12","Villa 13","Villa 14"],
  "Block 05": ["Villa 15","Villa 16"],
  "Block 06": ["Villa 17","Villa 18","Villa 19"],
  "Block 07": ["Villa 20","Villa 21","Villa 22"],
  "Block 08": ["Villa 23 & 24"],
  "Block 09": ["Villa 25","Villa 26","Villa 27","Villa 28","Villa 29","Villa 30","Villa 31"],
  "Block 10": ["Villa 32","Villa 33","Villa 34","Villa 35","Villa 36","Villa 37"],
  "Block 12": ["Villa 41","Villa 42","Villa 43"],
  "Block 13": ["Villa 44","Villa 45","Villa 46"],
};
const ABRAHAM_ALL_VILLAS: string[] = Object.values(ABRAHAM_BLOCKS).flat();

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
// Utilities
// ---------------------------------------------------------------------------
function round(n: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}
