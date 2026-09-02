// Amanvana Phase 1 project constants — the single source of truth.
//
// Every "Abraham has 41 villas across these 11 blocks" and "Elegant has 52
// villas" fact lived scattered across scorecardServer.ts and weeklyRules.ts
// (and earlier, inline in colabSync.ts). One file so a schedule change
// doesn't require hunting through 3-4 places to keep numbers consistent.
//
// When a NEW project onboards, create `src/lib/projects/<name>.ts` with the
// same shape and register it in `src/lib/projects/index.ts` (TBD).
//
// Post-launch (V2): move this into a `project_config` DB table so admin can
// edit without a deploy.

/** Contractor 1 (Abraham Thomas) block → villa-name map.
 *  41 villas across 11 blocks. Grouped-pair villas ("Villa 10 & 11") count
 *  as a single scheduling unit in Colab's tracker. */
export const AMANVANA_ABRAHAM_BLOCKS: Record<string, readonly string[]> = {
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

/** Flat list of every Abraham villa. */
export const AMANVANA_ABRAHAM_ALL_VILLAS: readonly string[] =
  Object.values(AMANVANA_ABRAHAM_BLOCKS).flat();

/** Villa number → display block code (no "Block " prefix — the scorecard view
 *  renders "Block {code}"). Derived from AMANVANA_ABRAHAM_BLOCKS. */
export const AMANVANA_VILLA_NUMBER_TO_BLOCK: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [block, villas] of Object.entries(AMANVANA_ABRAHAM_BLOCKS)) {
    const code = block.replace(/^Block\s+0*/i, "").padStart(2, "0"); // "Block 02" → "02"
    for (const v of villas) {
      // "Villa 10 & 11" → both 10 and 11 point to the same code
      const nums = [...v.matchAll(/(\d+)/g)].map((m) => parseInt(m[1], 10));
      for (const n of nums) map[n] = code;
    }
  }
  return map;
})();

/** Contractor scope villa counts. Business facts from the awarded contracts,
 *  authoritative source for the "villas in scope" tile even when the DB has
 *  fewer wbsNodes tagged (transitional state during onboarding). */
export const AMANVANA_CONTRACTOR_SCOPE: Record<string, number> = {
  "abraham thomas":     41,
  "elegant construction": 52,
};

/** Contractor canonical names. Use these anywhere the code needs to compare
 *  a contractor string, so a typo in one place doesn't drift from another. */
export const AMANVANA_CONTRACTORS = {
  abraham: "Abraham Thomas",
  elegant: "Elegant Construction",
} as const;
