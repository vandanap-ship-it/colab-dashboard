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
// Utilities
// ---------------------------------------------------------------------------
function round(n: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}
