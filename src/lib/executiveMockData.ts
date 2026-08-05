// Amanvana placeholder data for the executive dashboard.
// Structure derived from the real MSP file (Villas Schedule Updated.mpp, 2026-08-06):
//   • 12 blocks · 41 villas (grouped exactly as per MSP)
//   • 21 milestone sections (Foundation → Commissioning & Handover)
//   • 13 star sub-milestones per villa (concreting pours + snagging + handover)
//
// Real-progress plumbing lives in a follow-up (see scripts/import-msp.ts). Until
// then, the dashboards render off this file so the UI can be reviewed live.

export type BlockStatus = "healthy" | "warning" | "critical" | "not-started";

export interface BlockRollup {
  code: string;
  villas: number[];             // integer villa numbers ("Villa 10 & 11" flattened → [10, 11])
  villaLabels: string[];        // display strings ("Villa 25", "Villa 10 & 11")
  active: boolean;
  slipDays: number;             // handover slip for this block (max villa slip)
  currentSection: number;
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

export const MOCK_TODAY = new Date("2026-08-06");
export const PHASE_START = new Date("2026-04-14");
export const PHASE_END = new Date("2029-03-22");

// The 21 milestone sections tracked per villa. This is the top level; each
// section contains 1–3 ★ sub-milestones + prep tasks.
export const SECTIONS = [
  "Foundation / Substructure",
  "Plinth Level",
  "Ground Floor Structure",
  "First Floor Structure",
  "Second Floor Structure",
  "Terrace Works",
  "GF — Masonry & MEP Rough In",
  "FF — Masonry & MEP Rough In",
  "SF — Masonry & MEP Rough In",
  "External Development & Cladding",
  "External Finishes & Landscape",
  "MEP Service Works",
  "Lift Works",
  "MS Staircase — Detailed Sequence",
  "Interior Finishes — Ceilings",
  "Interior Finishes — Flooring",
  "Interior Finishes — Bathroom",
  "Interior Finishes — Doors & Fittings",
  "Internal Paint",
  "Automation, Lighting & Appliances",
  "Commissioning & Handover",
];

export const SECTION_HEADERS = SECTIONS.map((s) => s.toUpperCase());

// The 13 ★ sub-milestones per villa — from the MSP star-marked items.
export const SUB_MILESTONES = [
  "Footing RCC — Concreting ★",
  "Raft RCC — Concreting ★",
  "Retaining Wall Concreting ★",
  "Pedestal Column Concreting ★",
  "Plinth Beam Concreting ★",
  "Column GF→FF — Concreting ★",
  "GF Roof Beam + Slab — Concreting ★",
  "Column FF→SF — Concreting ★",
  "FF Roof Beam + Slab — Concreting ★",
  "Column SF→Terrace — Concreting ★",
  "SF Roof Beam + Slab — Concreting ★",
  "Snagging — Defect List & Rectification (30 Days) ★",
  "VILLA HANDOVER ★",
];

// Block-villa mapping — matches MSP outline exactly. All 12 blocks are the
// Abraham Thomas (A&T) scope (41 villas total). Active flag reflects which
// blocks are in execution today.
export const BLOCKS: BlockRollup[] = [
  { code: "9",  villas: [25,26,27,28,29,30,31], villaLabels: ["Villa 25","Villa 26","Villa 27","Villa 28","Villa 29","Villa 30","Villa 31"], active: true,  slipDays: 22, currentSection: 1, currentPct: 70, pod: "South Row East" },
  { code: "4",  villas: [12,13,14],             villaLabels: ["Villa 12","Villa 13","Villa 14"], active: true,  slipDays: 8,  currentSection: 2, currentPct: 55, pod: "Central East" },
  { code: "10", villas: [32,33,34,35,36,37],    villaLabels: ["Villa 32","Villa 33","Villa 34","Villa 35","Villa 36","Villa 37"], active: true,  slipDays: 16, currentSection: 1, currentPct: 60, pod: "South Row West" },
  { code: "6",  villas: [17,18,19],             villaLabels: ["Villa 17","Villa 18","Villa 19"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "2",  villas: [3,4,5],                villaLabels: ["Villa 03","Villa 04","Villa 05"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "5",  villas: [15,16],                villaLabels: ["Villa 15","Villa 16"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "3A", villas: [6,7,8],                villaLabels: ["Villa 06","Villa 07","Villa 08"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "3B", villas: [9,10,11],              villaLabels: ["Villa 09","Villa 10 & 11"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "East Entry" },
  { code: "7",  villas: [20,21,22],             villaLabels: ["Villa 20","Villa 21","Villa 22"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "8",  villas: [23,24],                villaLabels: ["Villa 23 & 24"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "Central East" },
  { code: "12", villas: [41,42,43],             villaLabels: ["Villa 41","Villa 42","Villa 43"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "West Row" },
  { code: "13", villas: [44,45,46],             villaLabels: ["Villa 44","Villa 45","Villa 46"], active: false, slipDays: 0,  currentSection: -1, currentPct: 0, pod: "West Row" },
];

// Per-villa slip snapshot. Only active villas populated with realistic values;
// inactive villas fall through to zero-defaults in accessor.
const VILLA_SLIPS: Record<number, { slip: number; pct: number; section: number; stale: number }> = {
  // Block 9 (active)
  25: { slip: 18, pct: 85, section: 1, stale: 4 },
  26: { slip: 26, pct: 60, section: 1, stale: 6 },
  27: { slip: 22, pct: 75, section: 1, stale: 5 },
  28: { slip: 30, pct: 55, section: 1, stale: 8 },
  29: { slip: 42, pct: 40, section: 1, stale: 12 },
  30: { slip: 36, pct: 90, section: 0, stale: 3 },
  31: { slip: 15, pct: 90, section: 1, stale: 2 },
  // Block 4 (active)
  12: { slip: 8,  pct: 60, section: 2, stale: 2 },
  13: { slip: 5,  pct: 70, section: 2, stale: 1 },
  14: { slip: 12, pct: 40, section: 1, stale: 3 },
  // Block 10 (active)
  32: { slip: 10, pct: 70, section: 1, stale: 1 },
  33: { slip: 24, pct: 55, section: 1, stale: 4 },
  34: { slip: 32, pct: 60, section: 1, stale: 7 },
  35: { slip: 46, pct: 100, section: 0, stale: 14 },
  36: { slip: 20, pct: 45, section: 1, stale: 3 },
  37: { slip: 38, pct: 55, section: 1, stale: 9 },
};

export function activeVillas(): VillaRollup[] {
  const rows: VillaRollup[] = [];
  for (const b of BLOCKS) {
    if (!b.active) continue;
    for (const n of b.villas) {
      const p = VILLA_SLIPS[n];
      if (!p) continue;
      rows.push({
        number: n, blockCode: b.code,
        slipDays: p.slip, pctComplete: p.pct,
        currentSection: p.section, staleDays: p.stale,
      });
    }
  }
  return rows;
}

export function blockStatus(b: BlockRollup): BlockStatus {
  if (!b.active) return "not-started";
  if (b.slipDays > 30) return "critical";
  if (b.slipDays > 0)  return "warning";
  return "healthy";
}

export function villaStatus(v: VillaRollup): "healthy" | "warning" | "critical" {
  if (v.slipDays > 30) return "critical";
  if (v.slipDays > 0)  return "warning";
  return "healthy";
}

// ---------------------------------------------------------------------------
// MILESTONE MATRIX — per-villa per-milestone data
// ---------------------------------------------------------------------------

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
// Keys: villa number → array of 21 planned dates (one per SECTIONS index).
// Only 3 sample villas populated inline; the rest fall back to synthesized dates.
const PLANNED_BASE: Record<number, string[]> = {
  12: [
    "2026-04-27","2026-06-24","2026-08-02","2026-09-10","2026-10-21","2026-11-19",
    "2026-11-30","2027-01-15","2027-03-01","2027-04-01","2027-05-15","2027-06-15",
    "2027-04-01","2027-05-01","2027-06-01","2027-06-20","2027-07-15","2027-08-10",
    "2027-08-25","2027-09-15","2027-11-05",
  ],
  25: [
    "2026-04-27","2026-06-24","2026-08-02","2026-09-10","2026-10-21","2026-11-19",
    "2026-11-30","2027-01-15","2027-03-01","2027-04-01","2027-05-15","2027-06-15",
    "2027-04-01","2027-05-01","2027-06-01","2027-06-20","2027-07-15","2027-08-10",
    "2027-08-25","2027-09-15","2027-11-05",
  ],
  13: [
    "2026-04-27","2026-06-24","2026-08-02","2026-09-10","2026-10-21","2026-12-01",
    "2026-12-10","2027-01-25","2027-03-10","2027-04-15","2027-05-25","2027-06-25",
    "2027-04-10","2027-05-10","2027-06-10","2027-06-30","2027-07-25","2027-08-20",
    "2027-09-01","2027-09-25","2027-11-17",
  ],
};

const ACTUAL: Record<number, Array<string | null>> = {
  12: ["2026-07-04", ...Array(20).fill(null)],
};

const PROJECTED: Record<number, Array<string | null>> = {
  12: [null, "2026-08-24", "2026-09-27", "2026-11-31", "2027-01-15", "2027-02-06",
       "2027-02-20", "2027-04-05", "2027-05-20", "2027-06-20", "2027-08-05",
       "2027-09-05", "2027-06-20", "2027-07-20", "2027-08-20", "2027-09-10",
       "2027-10-05", "2027-10-30", "2027-11-15", "2027-12-05", "2028-01-25"],
};

const CRM: Record<number, Array<{ date: string | null; delay: number | null; amount: number }>> = {
  12: [
    { date: "2026-05-15", delay: 0, amount: 250_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 400_000 },
    { date: null, delay: null, amount: 500_000 },
    { date: null, delay: null, amount: 500_000 },
    { date: null, delay: null, amount: 350_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 400_000 },
    { date: null, delay: null, amount: 400_000 },
    { date: null, delay: null, amount: 350_000 },
    { date: null, delay: null, amount: 400_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 250_000 },
    { date: null, delay: null, amount: 200_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 350_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 250_000 },
    { date: null, delay: null, amount: 200_000 },
    { date: null, delay: null, amount: 300_000 },
    { date: null, delay: null, amount: 1_500_000 },
  ],
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  return new Date(s + "T00:00:00");
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Synthesize planned dates for villas without inline data — pushes cadence
// forward based on block position + villa index so downstream widgets still
// have realistic dates until we import real MSP-per-villa data.
function synthesizePlanned(villaNum: number): string[] {
  const base = PLANNED_BASE[25]; // baseline cadence
  const offset = (villaNum % 10) * 4; // stagger a few days per villa
  return base.map((d) => {
    const dt = new Date(d + "T00:00:00");
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
  });
}

export function milestonesForVilla(villaNumber: number): MilestoneCell[] {
  const planned = PLANNED_BASE[villaNumber] ?? synthesizePlanned(villaNumber);
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

// Order: villas grouped by block, blocks in "active first" order.
export const MATRIX_VILLA_ORDER = BLOCKS.flatMap((b) => b.villas);

// ---------------------------------------------------------------------------
// CONTRACTORS + HEALTH SUMMARY
// ---------------------------------------------------------------------------

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
    name: "Abraham Thomas (A&T)",
    category: "Civil / Structural — Phase 1 & 2 Lead",
    scopeVillas: 41,
    activeVillas: 16, // Blocks 4, 9, 10 currently active
    completePct: 14,
    avgDelayDays: 22,
    criticalRisks: 4,
    health: "warning",
  },
  {
    name: "Contractor 2",
    category: "Civil / Structural — Phase 3 · TBD",
    scopeVillas: 52,
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
    atVillas: 41,
    atBlocks: 12,
    baselineStart: PHASE_START,
    baselineEnd: PHASE_END,
    projectedEnd: new Date(PHASE_END.getTime() + maxSlip * 86400000),
    totalDelayDays: maxSlip,
    reraDelayDays: 0,
    hindrances: 3,
    criticalBlocks: active.filter((b) => b.slipDays > 30).length,
    probability: maxSlip > 30 ? "low" : maxSlip > 14 ? "med" : "high",
    plannedPct: 2.74,
    achievedPct: 0.01,
    asOf: MOCK_TODAY,
  };
}
