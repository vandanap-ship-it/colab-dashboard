// Placeholder data matching the approved executive dashboard mockup (Amanvana AT scope).
// This will be replaced with real DB queries once Block/Villa/MilestoneSection are seeded.
//
// Milestone list matches the 9 structural milestones tracked in the live Colab app
// (Footing → Villa Handover). Sample dates & CRM fields taken from the 2026-07-14
// verified Snapshot inventory.

export type BlockStatus = "healthy" | "warning" | "critical" | "not-started";

export interface BlockRollup {
  code: string;
  villas: number[];
  active: boolean;
  slipDays: number;
  currentSection: number; // index into SECTIONS
  currentPct: number;
  pod: string;
}

export interface VillaRollup {
  number: number;
  blockCode: string;
  slipDays: number;
  pctComplete: number;
  currentSection: number;
  staleDays: number;
}

export const MOCK_TODAY = new Date("2026-07-14");
export const PHASE_START = new Date("2026-04-01");
export const PHASE_END = new Date("2028-02-17");

// 9 structural milestones per Colab live data
export const SECTIONS = [
  "Footing",
  "Plinth Beam",
  "Gr Floor Slab",
  "Gr Floor Blockwork",
  "1st Floor Slab",
  "1st Floor Blockwork",
  "2nd Floor Slab",
  "2nd Floor Blockwork",
  "Villa Handover",
];

// Uppercase display for pivot table column headers
export const SECTION_HEADERS = [
  "FOOTING",
  "PLINTH BEAM",
  "GR FLOOR SLAB",
  "GR FLOOR BLOCKWORK",
  "1ST FLOOR SLAB",
  "1ST FLOOR BLOCKWORK",
  "2ND FLOOR SLAB",
  "2ND FLOOR BLOCKWORK",
  "VILLA HANDOVER",
];

export const BLOCKS: BlockRollup[] = [
  { code: "4",  villas: [12, 13, 14],                 active: true,  slipDays: 8,  currentSection: 2, currentPct: 55, pod: "Central East" },
  { code: "9",  villas: [25, 26, 27, 28, 29, 30, 31], active: true,  slipDays: 22, currentSection: 1, currentPct: 70, pod: "South Row East" },
  { code: "10", villas: [32, 33, 34, 35, 36, 37],     active: true,  slipDays: 16, currentSection: 1, currentPct: 60, pod: "South Row West" },
  { code: "14", villas: [47, 48, 49, 50],             active: true,  slipDays: 38, currentSection: 1, currentPct: 30, pod: "Central Pod" },
  { code: "2",  villas: [3, 4, 5],                    active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "3A", villas: [6, 7, 8],                    active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "3B", villas: [9, 10, 11],                  active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "5",  villas: [15, 16],                     active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "6",  villas: [17, 18, 19],                 active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "7",  villas: [20, 21, 22],                 active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "8",  villas: [23, 24],                     active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
];

const VILLA_SLIPS: Record<number, { slip: number; pct: number; section: number; stale: number }> = {
  12: { slip: 8,  pct: 60,  section: 2, stale: 2 },
  13: { slip: 5,  pct: 70,  section: 2, stale: 1 },
  14: { slip: 12, pct: 40,  section: 1, stale: 3 },
  25: { slip: 18, pct: 85,  section: 1, stale: 4 },
  26: { slip: 26, pct: 60,  section: 1, stale: 6 },
  27: { slip: 22, pct: 75,  section: 1, stale: 5 },
  28: { slip: 30, pct: 55,  section: 1, stale: 8 },
  29: { slip: 42, pct: 40,  section: 1, stale: 12 },
  30: { slip: 36, pct: 90,  section: 0, stale: 3 },
  31: { slip: 15, pct: 90,  section: 1, stale: 2 },
  32: { slip: 10, pct: 70,  section: 1, stale: 1 },
  33: { slip: 24, pct: 55,  section: 1, stale: 4 },
  34: { slip: 32, pct: 60,  section: 1, stale: 7 },
  35: { slip: 46, pct: 100, section: 0, stale: 14 },
  36: { slip: 20, pct: 45,  section: 1, stale: 3 },
  37: { slip: 38, pct: 55,  section: 1, stale: 9 },
  47: { slip: 28, pct: 40,  section: 1, stale: 4 },
  48: { slip: 52, pct: 100, section: 0, stale: 18 },
  49: { slip: 40, pct: 30,  section: 1, stale: 6 },
  50: { slip: 44, pct: 80,  section: 0, stale: 11 },
};

export function activeVillas(): VillaRollup[] {
  const rows: VillaRollup[] = [];
  for (const b of BLOCKS) {
    if (!b.active) continue;
    for (const n of b.villas) {
      const p = VILLA_SLIPS[n];
      if (!p) continue;
      rows.push({
        number: n,
        blockCode: b.code,
        slipDays: p.slip,
        pctComplete: p.pct,
        currentSection: p.section,
        staleDays: p.stale,
      });
    }
  }
  return rows;
}

export function blockStatus(b: BlockRollup): BlockStatus {
  if (!b.active) return "not-started";
  if (b.slipDays > 30) return "critical";
  if (b.slipDays > 14) return "warning";
  if (b.slipDays > 0)  return "warning";
  return "healthy";
}

export function villaStatus(v: VillaRollup): "healthy" | "warning" | "critical" {
  if (v.slipDays > 30) return "critical";
  if (v.slipDays > 14) return "warning";
  if (v.slipDays > 0)  return "warning";
  return "healthy";
}

// ---------------------------------------------------------------------------
// MILESTONE MATRIX — per-villa per-milestone data
// ---------------------------------------------------------------------------
//
// Sample values pulled from the 2026-07-14 verified Snapshot inventory. Only a
// subset of villas × milestones are populated; the rest use the fallback
// generator further below.

export interface MilestoneCell {
  plannedDate: Date;
  actualDate: Date | null;
  projectedDate: Date | null;
  delayDays: number | null;
  crmDate: Date | null;
  crmDelayDays: number | null;
  plannedCollection: number; // INR
  progressPct: number;
}

// Baseline planned dates per milestone per villa (dd Mmm yyyy → Date).
// Keys: villa number → array of 9 planned dates (one per SECTIONS index).
const PLANNED: Record<number, string[]> = {
  25: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-09", "2026-09-10", "2026-11-19", "2026-10-21", "2026-12-27", "2027-11-05"],
  12: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-09", "2026-09-10", "2026-11-19", "2026-10-21", "2026-12-27", "2027-11-05"],
  13: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-22", "2026-09-10", "2026-12-01", "2026-10-21", "2027-01-08", "2027-11-17"],
  14: ["2026-06-22", "2026-08-19", "2026-09-29", "2026-12-06", "2026-11-06", "2027-01-14", "2026-12-16", "2027-02-21", "2027-12-29"],
  26: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-22", "2026-09-10", "2026-12-01", "2026-10-21", "2027-01-08", "2027-11-17"],
  27: ["2026-05-15", "2026-07-13", "2026-08-21", "2026-11-03", "2026-09-30", "2026-12-13", "2026-11-11", "2027-01-21", "2027-11-29"],
  28: ["2026-05-15", "2026-07-13", "2026-08-21", "2026-11-18", "2026-09-30", "2026-12-25", "2026-11-11", "2027-02-03", "2027-12-10"],
  29: ["2026-06-03", "2026-07-30", "2026-09-09", "2026-11-30", "2026-10-20", "2027-01-07", "2026-11-29", "2027-02-15", "2027-12-22"],
  30: ["2026-06-03", "2026-07-30", "2026-09-09", "2026-12-11", "2026-10-20", "2027-01-20", "2026-11-29", "2027-02-26", "2028-01-05"],
  31: ["2026-06-22", "2026-08-19", "2026-09-29", "2026-12-23", "2026-11-06", "2027-02-02", "2026-12-16", "2027-03-11", "2028-01-17"],
  32: ["2026-06-03", "2026-07-30", "2026-09-09", "2026-12-06", "2026-10-20", "2027-01-14", "2026-11-29", "2027-02-24", "2028-01-03"],
  33: ["2026-06-03", "2026-07-30", "2026-09-09", "2026-11-27", "2026-10-20", "2027-01-05", "2026-11-29", "2027-02-16", "2027-12-23"],
  34: ["2026-05-15", "2026-07-13", "2026-08-21", "2026-11-19", "2026-09-30", "2026-12-27", "2026-11-11", "2027-02-04", "2027-12-12"],
  35: ["2026-05-15", "2026-07-13", "2026-08-21", "2026-11-11", "2026-09-30", "2026-12-17", "2026-11-11", "2027-01-27", "2027-12-03"],
  36: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-22", "2026-09-10", "2026-12-01", "2026-10-21", "2027-01-08", "2027-11-17"],
  37: ["2026-04-27", "2026-06-24", "2026-08-02", "2026-10-09", "2026-09-10", "2026-11-19", "2026-10-21", "2026-12-27", "2027-11-05"],
  47: ["2026-07-10", "2026-09-07", "2026-10-18", "2027-01-08", "2026-11-27", "2027-02-16", "2027-01-05", "2027-03-25", "2028-01-31"],
  48: ["2026-07-10", "2026-09-07", "2026-10-18", "2027-01-18", "2026-11-27", "2027-02-24", "2027-01-05", "2027-04-04", "2028-02-08"],
  49: ["2026-07-28", "2026-09-27", "2026-11-05", "2027-02-04", "2026-12-15", "2027-03-04", "2027-01-24", "2027-04-14", "2028-02-16"],
  50: ["2026-07-28", "2026-09-27", "2026-11-05", "2027-02-05", "2026-12-15", "2027-03-05", "2027-01-24", "2027-04-15", "2028-02-17"],
};

// Actual completion dates (currently only Villa 12 Footing per live data).
const ACTUAL: Record<number, Array<string | null>> = {
  12: ["2026-07-04", null, null, null, null, null, null, null, null],
};

// Projected finish dates per villa/milestone (Colab-supplied; represents current
// slip forecast).
const PROJECTED: Record<number, Array<string | null>> = {
  25: ["2026-08-06", "2026-09-24", "2026-10-28", "2027-01-03", "2026-12-01", "2027-02-05", "2027-01-03", "2027-03-09", "2028-01-03"],
  12: [null,         "2026-08-24", "2026-09-27", "2026-12-03", "2026-10-31", "2027-01-05", "2026-12-03", "2027-02-06", "2027-12-03"],
  13: ["2026-08-06", "2026-09-24", "2026-10-28", "2027-01-02", "2026-12-01", "2027-02-04", "2027-01-03", "2027-03-06", "2028-01-08"],
  14: ["2026-09-22", "2026-11-10", "2026-12-14", "2027-02-17", "2027-01-15", "2027-03-20", "2027-02-17", "2027-04-22", "2028-02-24"],
  26: ["2026-08-06", "2026-09-24", "2026-10-28", "2027-01-02", "2026-12-01", "2027-02-04", "2027-01-03", "2027-03-06", "2028-01-08"],
  27: ["2026-08-22", "2026-10-10", "2026-11-14", "2027-01-18", "2026-12-17", "2027-02-20", "2027-01-17", "2027-03-22", "2028-01-27"],
  28: ["2026-08-22", "2026-10-10", "2026-11-14", "2027-01-19", "2026-12-17", "2027-02-20", "2027-01-17", "2027-03-23", "2028-01-24"],
  29: ["2026-09-07", "2026-10-27", "2026-12-03", "2027-02-06", "2027-01-04", "2027-03-07", "2027-02-05", "2027-04-11", "2028-02-12"],
  30: ["2026-09-07", "2026-10-27", "2026-12-03", "2027-02-06", "2027-01-04", "2027-03-09", "2027-02-05", "2027-04-08", "2028-02-07"],
  31: ["2026-07-21", "2026-08-19", "2026-12-14", "2027-02-16", "2027-01-15", "2027-03-21", "2027-02-17", "2027-04-20", "2028-02-24"],
  32: ["2026-09-05", "2026-10-25", "2026-12-01", "2027-02-04", "2027-01-02", "2027-03-07", "2027-02-03", "2027-04-07", "2028-02-10"],
  33: ["2026-09-05", "2026-10-25", "2026-12-01", "2027-02-04", "2027-01-02", "2027-03-06", "2027-02-03", "2027-04-09", "2028-02-10"],
  34: ["2026-08-21", "2026-10-09", "2026-11-13", "2027-01-18", "2026-12-16", "2027-02-19", "2027-01-16", "2027-03-22", "2028-01-24"],
  35: ["2026-08-21", "2026-10-09", "2026-11-13", "2027-01-19", "2026-12-16", "2027-02-18", "2027-01-16", "2027-03-22", "2028-01-22"],
  36: ["2026-08-06", "2026-09-24", "2026-10-28", "2027-01-02", "2026-12-01", "2027-02-04", "2027-01-03", "2027-03-06", "2028-01-08"],
  37: ["2026-08-06", "2026-09-24", "2026-10-28", "2027-01-03", "2026-12-01", "2027-02-05", "2027-01-03", "2027-03-09", "2028-01-03"],
  47: ["2026-10-08", "2026-11-27", "2026-12-30", "2027-03-02", "2027-01-31", "2027-04-06", "2027-03-05", "2027-05-05", "2028-03-09"],
  48: ["2026-10-08", "2026-11-27", "2026-12-30", "2027-03-04", "2027-01-31", "2027-04-04", "2027-03-05", "2027-05-07", "2028-03-08"],
  49: ["2026-10-24", "2026-12-11", "2027-01-13", "2027-03-19", "2027-02-15", "2027-04-18", "2027-03-20", "2027-05-24", "2028-03-24"],
  50: ["2026-10-24", "2026-12-11", "2027-01-13", "2027-03-19", "2027-02-15", "2027-04-18", "2027-03-20", "2027-05-24", "2028-03-24"],
};

// CRM committed collection dates (per villa/milestone). Colab currently returns
// "-" for most cells; we populate a few plausible values to exercise the UI.
const CRM: Record<number, Array<{ date: string | null; delay: number | null; amount: number }>> = {
  12: [
    { date: "2026-05-15", delay: 0, amount: 250000 },
    { date: null, delay: null, amount: 300000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 350000 },
    { date: null, delay: null, amount: 500000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 500000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 1500000 },
  ],
  25: [
    { date: "2026-05-15", delay: 0, amount: 250000 },
    { date: null, delay: null, amount: 300000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 350000 },
    { date: null, delay: null, amount: 500000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 500000 },
    { date: null, delay: null, amount: 400000 },
    { date: null, delay: null, amount: 1500000 },
  ],
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  return new Date(s + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Build the per-villa cell array for a given villa. Returns 9 cells (one per
// milestone) with Planned / Actual / Projected / Delay / CRM / Progress % filled
// from the live-sample tables above. Missing entries fall back to nulls.
export function milestonesForVilla(villaNumber: number): MilestoneCell[] {
  const planned = PLANNED[villaNumber];
  if (!planned) return [];
  const actual = ACTUAL[villaNumber] ?? [];
  const projected = PROJECTED[villaNumber] ?? [];
  const crm = CRM[villaNumber] ?? [];
  return SECTIONS.map((_, i): MilestoneCell => {
    const pd = parseDate(planned[i]);
    const ad = parseDate(actual[i]);
    const pj = parseDate(projected[i]);
    const c = crm[i];
    const delayDays =
      ad && pd ? Math.max(0, daysBetween(pd, ad))
        : pj && pd ? Math.max(0, daysBetween(pd, pj))
        : null;
    return {
      plannedDate: pd!,
      actualDate: ad,
      projectedDate: pj,
      delayDays,
      crmDate: c?.date ? parseDate(c.date) : null,
      crmDelayDays: c?.delay ?? null,
      plannedCollection: c?.amount ?? 0,
      progressPct: ad ? 100 : 0,
    };
  });
}

// List of villas that appear in the Milestone Matrix (matches Colab active tab
// strip order — Villa 25 first per live app).
export const MATRIX_VILLA_ORDER = [
  25, 12, 13, 14, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 47, 48, 49, 50,
];

// Contractor rollups (mockup: Abraham Thomas covers 39 villas, second contractor TBD)
export interface ContractorRollup {
  name: string;
  scopeVillas: number;
  activeVillas: number;
  completePct: number;
  avgDelayDays: number;
  criticalRisks: number;
  health: "healthy" | "ok" | "warning" | "critical" | "tbd";
  category: string;
}

export const CONTRACTORS: ContractorRollup[] = [
  {
    name: "Abraham Thomas",
    category: "Civil / Structural — Phase 1 Lead",
    scopeVillas: 39,
    activeVillas: 20,
    completePct: 14,
    avgDelayDays: 18,
    criticalRisks: 3,
    health: "warning",
  },
  {
    name: "Contractor 2",
    category: "Civil / Structural — Phase 2 · TBD",
    scopeVillas: 54,
    activeVillas: 0,
    completePct: 0,
    avgDelayDays: 0,
    criticalRisks: 0,
    health: "tbd",
  },
];

export interface ProjectHealthSummary {
  totalPlots: number;
  inScope: number;
  modelVillas: number;
  phase1Villas: number;
  phase1BlocksActive: number;
  atVillas: number;
  atBlocks: number;
  baselineStart: Date;
  baselineEnd: Date;
  projectedEnd: Date;
  totalDelayDays: number;
  reraDelayDays: number;
  hindrances: number;
  criticalBlocks: number;
  probability: "low" | "med" | "high";
  plannedPct: number;
  achievedPct: number;
  asOf: Date;
}

export function healthSummary(): ProjectHealthSummary {
  const active = BLOCKS.filter((b) => b.active);
  const maxSlip = Math.max(0, ...active.map((b) => b.slipDays));
  return {
    totalPlots: 95,
    inScope: 93,
    modelVillas: 2,
    phase1Villas: active.reduce((n, b) => n + b.villas.length, 0),
    phase1BlocksActive: active.length,
    atVillas: 39,
    atBlocks: 11,
    baselineStart: PHASE_START,
    baselineEnd: PHASE_END,
    projectedEnd: new Date(PHASE_END.getTime() + maxSlip * 86400000),
    totalDelayDays: maxSlip,
    reraDelayDays: 0,
    hindrances: 3,
    criticalBlocks: active.filter((b) => b.slipDays > 20).length,
    probability: maxSlip > 30 ? "low" : maxSlip > 14 ? "med" : "high",
    plannedPct: 2.74,
    achievedPct: 0.01,
    asOf: MOCK_TODAY,
  };
}
